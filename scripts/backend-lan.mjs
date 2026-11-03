import 'dotenv/config';
import { networkInterfaces } from 'node:os';
import { spawn } from 'node:child_process';

const port = process.env.BACKEND_PORT || '3001';
console.log('Starting the configured backend on local network interfaces. Database and AI configuration follow .env.');
console.log('Use a trusted local network. No router port forwarding is required.');
for (const [name, addresses] of Object.entries(networkInterfaces())) {
  for (const address of addresses || []) if (address.family === 'IPv4' && !address.internal) {
    console.log(`${name}: http://${address.address}:${port}/dashboard`);
    console.log(`  Device contract: http://${address.address}:${port}/api/device-contract`);
  }
}
console.log('Choose the Wi-Fi/LAN adapter connected to the camera. If unreachable, check the private-network firewall and AP client isolation.');
const child = spawn(process.execPath, ['apps/backend/src/server.js'], {
  env: { ...process.env, BACKEND_HOST: '0.0.0.0' }, stdio: 'inherit', windowsHide: true
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill());
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
