import { app, shell, BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import icon from '../../build/icon.ico?asset';
import { promises as dns } from 'dns';
import dgram from 'dgram';
import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

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


const BindPort = 106120;
let relayHost = 'delthas.fr';
const RelayPort = 14763;

let mainWindow;

async function getIP(domain) {
  try {
    const result = await dns.lookup(domain);
    return result.address;
  } catch (err) {
    console.error('DNS lookup error:', err);
  }
}

ipcMain.on('checkFW', async (event, arg) => {
  console.log(RelayHost);
  const { result, msg } = await checkFirewallRule();
  event.reply('checkFW', { result, msg });
});

const client = dgram.createSocket('udp4');

client.on('error', (err) => {
  console.error('Socket error:', err);
  client.close();
});

let timers = [];
let myExternalIpPort = '';

// 5秒毎にIPを登録し、さらに自分の情報も取得する
function register2AP(event, myIp, myPort) {
  const portBuf = (port) => {
    const buf = Buffer.alloc(2);
    buf.writeUInt16BE(port, 0);
    return buf;
  };
  const ipPortBuf = (ip, port) => {
    const buf = Buffer.alloc(8);
    buf.writeUInt16BE(port, 0);
    buf.writeUInt8(ipParts[0], 2);
    buf.writeUInt8(ipParts[1], 3);
    buf.writeUInt8(ipParts[2], 4);
    buf.writeUInt8(ipParts[3], 5);
    buf.writeUInt16BE(port, 6);
    return buf;
  };

  client.send(portBuf(myPort), RelayPort, relayHost, (err) => {
    if (err) {
      const { result, msg } = { result: false, msg: 'オートパンチサーバーにアクセスできませんでした。\nネットワークの設定を見直してください。' };
      console.error('送信エラー:', err);
      event.reply('HtoAP', { result, msg });
      return;
    }
  });
  setTimeout(() => {
    client.send(ipPortBuf(myIp, myPort), RelayPort, relayHost, (err) => {
      if (err) {
        const { result, msg } = { result: false, msg: 'オートパンチサーバーにアクセスできませんでした。\nネットワークの設定を見直してください。' };
        console.error('送信エラー:', err);
        event.reply('HtoAP', { result, msg });
        return;
      }
    });
  }, 50);
}

function getApResponse(msg, rinfo) {
  if (msg.length >= 8) {
    const peerPort = msg.readUInt16BE(0);
    peerNatPort = msg.readUInt16BE(2);
    peerIp = `${msg[4]}.${msg[5]}.${msg[6]}.${msg[7]} `;
    myExternalIpPort = `${peerIp}:${peerNatPort}`;

    console.log(`Host:${peerIp}:${peerPort}/NAT Port:${peerNatPort}`);

    myExternalIpPort = `${peerIp}:${peerNatPort}`;
    mainWindow.webContents.send('get-my-ip', myExternalIpPort);
  }
}

ipcMain.on('HtoAP', async (event, arg) => {
  try {
    relayHost = await getIP('delthas.fr'); // AP server
  } catch (e) {
    console.error('DNS lookup error:', e);
    event.reply('HtoAP', { result: false, msg: 'オートパンチサーバーのDNS情報を取得できませんでした。\nネットワークの設定を見直してください。' });
    return;
  }
  const [myIp, myPort] = arg.split(':');
  register2AP(event, myIp, myPort);



  client.on('message', holepunchProcess);


  const waitClient = (msg, rinfo) => {


  };

  console.log('オートパンチサーバーにアクセス');
  // 5秒毎にIPを登録

});

ipcMain.on('do-ping-ap', async (event, arg) => {

  const [trgIp, trgPort] = arg.split(':');

  // オートパンチからホストの情報を取得
  const relayHost = await getIP('delthas.fr'); // AP server
  const relayPort = 14763;
  const targetIp = trgIp;
  const targetPort = Number(trgPort);

  const ipParts = targetIp.split('.').map(Number);

  const buf = Buffer.alloc(8);
  buf.writeUInt16BE(targetPort, 0);
  buf.writeUInt8(ipParts[0], 2);
  buf.writeUInt8(ipParts[1], 3);
  buf.writeUInt8(ipParts[2], 4);
  buf.writeUInt8(ipParts[3], 5);
  buf.writeUInt16BE(targetPort, 6);

  let punched = false;
  let peerIp = '';
  let peerNatPort = 0;
  let punchTimeouts = [];

  function holepunchProcess(msg, rinfo) {
    if (!punched && msg.length >= 8) {
      console.log('オートパンチサーバーから情報取得成功');
      // 最初のメッセージ → ホストの情報
      const peerPort = msg.readUInt16BE(0);
      peerNatPort = msg.readUInt16BE(2);
      peerIp = `${msg[4]}.${msg[5]}.${msg[6]}.${msg[7]} `;
      console.log(`Host:${peerIp}:${peerPort}/NAT Port:${peerNatPort}`);

      // ホールパンチ
      for (let i = 0; i < 10; i++) {
        const timeoutId = setTimeout(() => {
          const msg = Buffer.from([0]);
          client.send(msg, peerNatPort, peerIp, (err) => {
            if (err) console.error('送信エラー:', err);
            // else console.log(`send holepunch ${i + 1}: ${peerIp}:${peerNatPort}`);
          });
        }, i * 190);
        punchTimeouts.push(timeoutId);
      }
      punchTimeouts.push(setTimeout(() => {
        console.log('ホールパンチ失敗、ダメ元で計測');
        client.removeListener('message', holepunchProcess);
        ipcMain.emit('do-ping', event, `${peerIp}:${peerNatPort}`);
      }, 2000)); // 2秒後にタイムアウト
      punched = true; // 二重処理防止
    } else {
      // 2回目以降 → 相手からの応答
      // 既に同じ相手と計測をした場合、holepunchが既に実行中の可能性があるので検知
      if (msg[0] === 0x00 && rinfo.address === peerIp) {
        punchTimeouts.forEach(clearTimeout);
        punchTimeouts = [];
        console.log(`recv holepunch reply from ${peerIp}`);
        punched = true;
        client.removeListener('message', holepunchProcess);
        ipcMain.emit('do-ping', event, `${peerIp}:${peerNatPort}`);
      }
    }
  }

  client.on('message', holepunchProcess);

  client.send(buf, relayPort, relayHost, () => {
    console.log('オートパンチサーバーにアクセス');
    // 2秒後にタイムアウト
    setTimeout(() => {
      if (!punched) {
        console.log('オートパンチサーバーから情報取得失敗、通常のPORTで計測');
        client.removeListener('message', holepunchProcess);
        ipcMain.emit('do-ping', event, `${trgIp}:${trgPort}`);
      }
    }, 2000);
  });

});

ipcMain.on('do-ping', (event, arg) => {
  const [trgIp, trgPort] = arg.split(':');

  let postCount = 0;
  let recvCount = 0;
  let timeouts = 0;
  let sendTime = [];
  let result = [];

  function delayCheck(msg) {
    if (msg[0] !== 0x03) return;
    if (timeouts > 0) {
      timeouts--;
      getPing(recvCount, false);
    } else {
      getPing(recvCount, (Date.now() - sendTime[recvCount]) / 16.6, false);
    }
    recvCount++;
  }

  const getPing = (idx, v) => {
    if (result[idx]) return;
    result[idx] = v;
    console.log('result', idx, v);
    event.reply('result-ping', result[idx]);
  };

  client.on('message', delayCheck);

  const strToByte = (str) => str.match(/.{2}/g).map((s) => parseInt(s, 16));
  function intervalHelper() {
    const data = WatchBuffer1();
    client.send(data, 0, data.length, trgPort, trgIp, (err) => {
      sendTime[postCount] = Date.now();
      setTimeout((pc) => {
        timeouts += result[pc] ? 0 : 1;
        getPing(pc, false);
      }, 800, postCount);
      postCount++;
      if (err) {
        throw err;
      }
    });
  }

  intervalHelper();

  const timer = setInterval(intervalHelper, 1000);

  setTimeout(() => {
    clearInterval(timer);
    event.reply('result-ping', 'end');
    client.removeListener('message', delayCheck);
  }, 1000 * 7 - 100);

  // https://hackmd.io/@yoG90kkvSRmw42HiR0pozw/H1V3vcVTf?type=view
  function WatchBuffer1() {
    const port = trgPort.toString(16).padStart(4, '0').match(/.{2}/g);
    const ip = trgIp
      .split('.')
      .map((v) => Number(v).toString(16).padStart(2, '0'));
    const bytes = [
      ['01'],
      ['0200'],
      port,
      ip,
      ['00000000'],
      ['00000000'],
      ['02'],
      ['00'],
      port,
      ip,
      ['00000000'],
      ['00000000'],
      ['0000'],
      ['0000'],
    ];
    return Buffer.concat(
      bytes.map((byte) => Buffer.from(byte.map((s) => strToByte(s)).flat()))
    );
  }
});

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
    title: '非想天則ラグチェッカー',
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

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // すでにインスタンスが存在する場合は終了
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
  app.quit();
} else {
  app.whenReady().then(() => {
    createWindow();
    client.bind(BindPort);
    electronApp.setAppUserModelId(app.getName());
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window);
    });
  });
}


// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
  client.close();
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
