import { randomBytes, scrypt } from 'node:crypto';
import process from 'node:process';

if (!process.stdin.isTTY) {
	console.error('터미널에서 실행해 주세요. 비밀번호를 명령행 인수로 전달하지 마세요.');
	process.exit(1);
}

process.stdout.write('Password: ');
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding('utf8');

let password = '';
process.stdin.on('data', (key) => {
	if (key === '\u0003') process.exit(130);
	if (key === '\r' || key === '\n') {
		process.stdin.setRawMode(false);
		process.stdin.pause();
		process.stdout.write('\n');
		if (!password) process.exitCode = 1;
		else {
			const salt = randomBytes(16);
			scrypt(
				password,
				salt,
				64,
				{ N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
				(error, keyValue) => {
					if (error) throw error;
					console.log(
						`scrypt$16384$8$1$${salt.toString('base64url')}$${keyValue.toString('base64url')}`
					);
				}
			);
		}
		password = '';
		return;
	}
	if (key === '\u007f') password = password.slice(0, -1);
	else password += key;
});
