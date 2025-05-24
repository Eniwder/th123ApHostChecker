import { app, shell, BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import icon from '../../build/icon.ico?asset';
import { promises as dns } from 'dns';
import dgram from 'dgram';
import { exec } from 'child_process';
import { promisify } from 'util';
const { dialog } = require('electron');
const execAsync = promisify(exec);

const BindPort = 106120;
const RelayHost = 'delthas.fr';
const RelayPort = 14763;
const client = dgram.createSocket('udp4');
const StunHost = 'stun.l.google.com';
const StunPort = 19302;

let mainWindow;
let timers = [];
let myExternalIpPort = '';
let msgHandler = null;
let clientIp = '';
let clientPort = 0;

ipcMain.on('checkFW', async (event, arg) => {
  const ret = await checkFirewallRule();
  cleanupAndReply('checkFW', event, ret);
});

ipcMain.on('HtoAP', async (event, arg) => {
  let relayIp = '';
  try {
    relayIp = await getIP(RelayHost); // AP server
  } catch (e) {
    cleanupAndReply('HtoAP', event, { result: false, msg: 'オートパンチサーバーのDNS情報を取得できませんでした。\nネットワークの設定を見直してください。' });
    return;
  }
  const [myIp, myPort] = arg.split(':');
  // 5秒毎にIPを登録し、さらに自分の情報も取得する
  msgHandler = getApResponse(event, myIp, myPort);
  client.on('message', msgHandler);
  timer.push(setInterval(() => {
    register2AP(event, myIp, myPort, relayIp);
  }, 5000));
});

ipcMain.on('toSTUN', async (event, arg) => {
  let stunIp = '';
  try {
    stunIp = await getIP(StunHost); // AP server
  } catch (e) {
    cleanupAndReply('toSTUN', event, { result: false, msg: 'GoogleのSTUNサーバーのDNS情報を取得できませんでした。\nネットワークの設定を見直してください。' });
    return;
  }
  msgHandler = getStunResponse(event);
  client.on('message', msgHandler);
  send2Stun(event, stunIp, StunPort);
});

ipcMain.on('toClient', async (event, arg) => {
  msgHandler = getHolepunchResponse(event, 'toClient', clientIp);
  client.on('message', msgHandler);
  holepunching(event, 'toClient', clientIp, clientPort);
});

// 各ステップに必要な関数群 *******************************************

// TODO 自分自身もチェックする
async function checkFirewallRule() {
  const psCommand = `
Get-NetFirewallRule | Where-Object {
  $_.Name -like "*th123.exe"
} | Select-Object Name,Direction,Action,Enabled
`.replace(/"/g, '\\"').replace(/\n/g, ' ');

  const { stdout, stderr } = await execAsync(`powershell -Command "${psCommand}"`);
  if (stderr) {
    console.error(`標準エラー出力: ${stderr} `);
    return { result: false, msg: stderr };
  } else {
    const result = stdout.trim().split('\n').some(line => line.includes('UDP') && line.includes('Inbound') && line.includes('Allow') && line.includes('True'));
    const msg = result ? 'ファイアウォールルールが正しく設定されています。' : 'ファイアウォールルールが正しく設定されていません。';
    return { result, msg };
  }
}

function register2AP(event, myIp, myPort, relayIp) {
  const portBuf = (port) => {
    const buf = Buffer.alloc(2);
    buf.writeUInt16BE(port, 0);
    return buf;
  };
  const ipPortBuf = (ip, port) => {
    const buf = Buffer.alloc(8);
    const ipParts = ip.split('.').map(Number);
    buf.writeUInt16BE(port, 0);
    buf.writeUInt8(ipParts[0], 2);
    buf.writeUInt8(ipParts[1], 3);
    buf.writeUInt8(ipParts[2], 4);
    buf.writeUInt8(ipParts[3], 5);
    buf.writeUInt16BE(port, 6);
    return buf;
  };

  client.send(portBuf(myPort), RelayPort, relayIp, (err) => {
    if (err) {
      console.error('送信エラー:', err);
      cleanupAndReply('HtoAP', event, { result: false, msg: 'オートパンチサーバーにアクセスできませんでした。\nネットワークの設定を見直してください。' });
      return;
    }
  });
  setTimeout(() => {
    client.send(ipPortBuf(myIp, myPort), RelayPort, relayIp, (err) => {
      if (err) {
        console.error('送信エラー:', err);
        cleanupAndReply('HtoAP', event, { result: false, msg: 'オートパンチサーバーにアクセスできませんでした。\nネットワークの設定を見直してください。' });
        return;
      }
    });
  }, 50);
}

// https://github.com/delthas/autopunch/blob/db0b962a8bed74179997e755e851f99e885a10d1/autopunch-relay/relay.go#L112
function getApResponse(event, myIp) {
  let msgs = [];
  return function getApResponseHelper(msg, rinfo) {
    if (msg.length >= 8) {
      const { port1, port2, ip } = parseApResponse(msg);
      // ホストからクライアントっぽくメッセージを送信もするので、ここではclient用のメッセージも受け取る
      /// ややこしいが、自分の外部ポートを取得するために必要な処理
      if (ip === myIp) { // for server msg from AP(クライアントからの凸)
        if (myExternalIpPort === '') return; // まだ自分のIP:Portを取得していない場合は無視
        msgs.push('クライアントからの接続を受け取りました。');
        msgs.push(`　自身(ホスト)の外部IP:Port[${myExternalIpPort}]`);
        msgs.push(`　クライアントの外部IP:Port[${ip}:${port1}]`);
        clientIp = ip;
        clientPort = port1;
        console.log(`Setting Client Info: ${ip}:${port1}`);
        client.removeListener('message', msgHandler);
        cleanupAndReply('HtoAP', event, { result: true, msg: msgs });
        timers.forEach((t) => clearInterval(t));
      } else { // for client msg from AP(自身のダミー凸の応答)
        myExternalIpPort = `${ip}:${port2}`;
      }
    }
  };
}

function parseApResponse(msg) {
  const port1 = msg.readUInt16BE(0);
  const port2 = msg.readUInt16BE(2);
  const ip = `${msg[4]}.${msg[5]}.${msg[6]}.${msg[7]}`;
  return { port1, port2, ip };
}

async function createWindow() {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 600,
    height: 800,
    minWidth: 600,
    webPreferences: {
      ...(process.platform === 'linux' ? { icon } : {}),
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
    title: 'th123ConnectivityTester',
  });
  mainWindow.setMenuBarVisibility(false);

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function getStunResponse(event) {
  return function getStunResponseHelper(msg, rinfo) {
    if (msg.length >= 20) {
      const stunInfo = parseStunResponse(msg);
      if (stunInfo) {
        console.log(`Your global IP: ${stunInfo.ip}, Port: ${stunInfo.port}`);
        const myExternalIpPortByStun = `${stunInfo.ip}:${stunInfo.port}`;
        if (myExternalIpPort === myExternalIpPortByStun) {
          cleanupAndReply('toSTUN', event, { result: true, msg: `外部ポートに変化はありませんでした。` });
        } else {
          cleanupAndReply('toSTUN', event, { result: false, msg: `外部ポートに変化がありました。\nNATが原因でホストは不可能です。\n変化後の外部IP:Port[${myExternalIpPortByStun}]` });
        }
      } else {
        cleanupAndReply('toSTUN', event, { result: false, msg: `STUNサーバーからの応答の解析に失敗しました。\n` });
      }
    }
  };
}

function send2Stun(event, stun, port) {
  const stunRequest = createGoogleStunBindingRequest();
  client.send(stunRequest, port, stun, (err) => {
    if (err) {
      cleanupAndReply('toSTUN', event, { result: false, msg: 'STUNサーバーへの接続に失敗しました。\nネットワークの設定を見直してください。' });
      console.error('Error sending message:', err);
    } else {
      console.log(`STUN Binding Request sent to ${stun}:${port}`);
    }
  });
  function createGoogleStunBindingRequest() {
    const buf = Buffer.alloc(20);
    // STUN binding request header
    buf.writeUInt16BE(0x0001, 0); // Message Type: Binding Request
    buf.writeUInt16BE(0x0000, 2); // Message Length: 0
    buf.writeUInt32BE(0x2112A442, 4); // Magic Cookie
    // Transaction ID: 12 bytes (ランダムでOK)
    for (let i = 0; i < 12; i++) {
      buf[8 + i] = Math.floor(Math.random() * 256);
    }
    return buf;
  }
}

function parseStunResponse(msg) {
  // ヘッダーは20バイト
  let offset = 20;
  while (offset < msg.length) {
    const attrType = msg.readUInt16BE(offset);
    const attrLen = msg.readUInt16BE(offset + 2);
    // XOR-MAPPED-ADDRESS属性は0x0020
    if (attrType === 0x0020) {
      const family = msg[offset + 5];
      let port = msg.readUInt16BE(offset + 6);
      port ^= 0x2112;
      let ip;
      if (family === 0x01) { // IPv4
        const ipBuf = msg.slice(offset + 8, offset + 12);
        const magicCookie = msg.readUInt32BE(4);
        for (let i = 0; i < 4; i++) {
          ipBuf[i] ^= (magicCookie >> ((3 - i) * 8)) & 0xff;
        }
        ip = Array.from(ipBuf).join('.');
      } else if (family === 0x02) { // IPv6
        // IPv6対応は省略
        ip = 'IPv6 not supported';
      }
      return { ip, port };
    }
    offset += 4 + attrLen;
  }
  return null;
}

function holepunching(event, evName, trgIp, trgPort) {
  const trgName = evName === 'toClient' ? 'クライアント' : 'ホスト';
  console.log(`start holepunching to ${trgName}[${trgIp}:${trgPort}]`);
  timers.push(setInterval(() => {
    const msg = Buffer.from([0]);
    client.send(msg, trgPort, trgIp, (err) => {
      if (err) {
        console.error('送信エラー:', err);
        cleanupAndReply(evName, event, { result: false, msg: `${trgName}[${trgIp}:${trgPort}]へのデータの送信に失敗しました。\nネットワークの設定を見直してください。` });
      }
    });
  }, 200));
}

function getHolepunchResponse(event, evName, trgIp) {
  const msg = evName === 'toClient' ? 'クライアントと接続が確認できました🎉 ホスト可能です。' : 'ホストと接続が確認できました🎉';
  return function getStunResponseHelper(msg, rinfo) {
    if (msg[0] === 0x00 && rinfo.address === trgIp) {
      console.log(`recv holepunch reply from ${trgIp}`);
      cleanupAndReply(evName, event, { result: true, msg });
    }
  };
}

// 各ステップに必要な関数群ここまで *******************************************



client.on('error', (err) => {
  console.error('Socket error:', err);
  dialog.showErrorBox(`ソケットエラーが発生しました。アプリケーションを再起動してください。\n${err.message}`);
  client.close();
});

// 多重起動を防止
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
  app.quit();
} else {
  app.whenReady().then(() => {
    createWindow();
    try {
      client.bind(BindPort);
    } catch (e) {
      client.bind(BindPort + 1);
    }
    electronApp.setAppUserModelId(app.getName());
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window);
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
  client.close();
});

async function getIP(domain) {
  try {
    const result = await dns.lookup(domain, { family: 4 }); // IPv4のみ
    return result.address;
  } catch (err) {
    console.error('DNS lookup error:', err);
    throw new Error(`DNS lookup error for ${domain}: ${err.message}`);
  }
}

function cleanupAndReply(evName, event, ret) {
  if (msgHandler) client.removeListener('message', msgHandler);
  timers.forEach((t) => clearInterval(t));
  timers = [];
  event.reply(evName, ret);
}


