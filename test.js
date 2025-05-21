const exec = require('child_process').exec;

const psCommand = `
Get-NetFirewallRule | Where-Object {
  $_.Name -like "*th123.exe"
} | Select-Object Name,Direction,Action,Enabled
`.replace(/"/g, '\\"').replace(/\n/g, ' ');


exec(`powershell -Command "${psCommand}"`, (error, stdout, stderr) => {
  if (error) {
    console.error(`エラー: ${error.message} `);
    return;
  }
  if (stderr) {
    console.error(`標準エラー出力: ${stderr} `);
    return;
  }
  console.log(`ファイアウォールルール: \n${stdout} `);
  // stdout.trim().split('\n').forEach(line => { const cols = line.trim().split(/\s+/); console.log(cols); });
  console.log(stdout.trim().split('\n').some(line => line.includes('UDP') && line.includes('Inbound') && line.includes('Allow') && line.includes('True')));
});
