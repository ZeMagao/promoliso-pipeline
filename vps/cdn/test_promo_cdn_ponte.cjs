#!/usr/bin/env node
// Harness da ponte de imagem. Offline: não busca nada na internet.
//
// O risco aqui é virar proxy aberto: um endpoint que baixa qualquer URL e serve pelo nosso
// domínio é exatamente o que um abusador procura. Por isso a lista de hosts é a única porta, e
// este harness existe para provar que ela não deixa passar o que não deve.
//
//   node vps/cdn/test_promo_cdn_ponte.cjs
const { hostPermitido, HOSTS_PONTE } = require('./promo-cdn.cjs');

let falhas = 0;
const ok = (nome, cond, detalhe) => {
  console.log((cond ? 'PASS  ' : 'FALHA ') + nome + (cond || !detalhe ? '' : '  -> ' + detalhe));
  if (!cond) falhas += 1;
};

// Os dois hosts medidos como bloqueadores do Cloudinary
ok('adrenaline passa', hostPermitido('https://www.adrenaline.com.br/wp-content/uploads/2026/09/x.jpeg'));
ok('adrenaline sem www passa', hostPermitido('https://adrenaline.com.br/img/x.jpg'));
ok('blogger (GameBlast) passa', hostPermitido('https://blogger.googleusercontent.com/img/b/R29vZ2xl/AAA/s1920/x.png'));
ok('a lista tem exatamente os 2 hosts medidos', HOSTS_PONTE.length === 2, HOSTS_PONTE.join(','));

// O que NÃO pode passar
const PROIBIDOS = [
  'https://evil.com/payload.exe',
  'https://adrenaline.com.br.evil.com/x.jpg',
  'https://evil.com/?x=adrenaline.com.br',
  'http://www.adrenaline.com.br/x.jpg',
  'https://127.0.0.1/x.jpg',
  'https://localhost:5678/rest/login',
  'file:///etc/passwd',
  'https://169.254.169.254/latest/meta-data/',
  '',
  'nao-e-url',
];
for (const u of PROIBIDOS) {
  ok(`recusa ${u.slice(0, 44) || '(vazio)'}`, !hostPermitido(u));
}
// Subdomínio legítimo do host permitido continua passando (o CDN do WordPress varia)
ok('subdomínio do host permitido passa', hostPermitido('https://cdn.adrenaline.com.br/x.jpg'));
// http:// é recusado mesmo no host certo: o Cloudinary e o Meta só aceitam https
ok('http não passa nem no host certo', !hostPermitido('http://adrenaline.com.br/x.jpg'));

console.log('');
console.log(falhas ? `${falhas} FALHA(S)` : 'TUDO PASSOU');
process.exit(falhas ? 1 : 0);
