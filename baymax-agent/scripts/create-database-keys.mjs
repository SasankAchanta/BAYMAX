import {generateKeyPairSync} from 'node:crypto';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),directory=path.join(root,'.spacetime');
mkdirSync(directory,{recursive:true});
if(!existsSync(path.join(directory,'id_ecdsa'))){const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1',publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});writeFileSync(path.join(directory,'id_ecdsa'),pair.privateKey);writeFileSync(path.join(directory,'id_ecdsa.pub'),pair.publicKey)}
