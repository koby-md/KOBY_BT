import './config.js';

import { createRequire } from 'module';
import path, { join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { platform } from 'process';

import chalk from 'chalk';
import * as ws from 'ws';

import {
    readdirSync,
    statSync,
    unlinkSync,
    existsSync,
    readFileSync,
    watch
} from 'fs';

import fs from 'fs';

import yargs from 'yargs';
import { spawn } from 'child_process';
import lodash from 'lodash';
import syntaxerror from 'syntax-error';
import { tmpdir } from 'os';

import { makeWASocket } from './lib/simple.js';
import { protoType, serialize } from './lib/simple.js';

import { Low, JSONFile } from 'lowdb';
import pino from 'pino';

import { mongoDB, mongoDBV2 } from './lib/mongoDB.js';
import store from './lib/store.js';

import readline from 'readline';
import moment from 'moment-timezone';
import NodeCache from 'node-cache';

const {
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    jidNormalizedUser
} = await import('@whiskeysockets/baileys');

const { chain } = lodash;


// ============================================================
// GLOBAL HELPERS
// ============================================================

protoType();
serialize();

global.__filename = function filename(
    pathURL = import.meta.url,
    rmPrefix = platform !== 'win32'
) {
    return rmPrefix
        ? /file:\/\/\//.test(pathURL)
            ? fileURLToPath(pathURL)
            : pathURL
        : pathToFileURL(pathURL).toString();
};

global.__dirname = function dirname(pathURL) {
    return path.dirname(global.__filename(pathURL, true));
};

global.__require = function require(dir = import.meta.url) {
    return createRequire(dir);
};


global.API = (
    name,
    path = '/',
    query = {},
    apikeyqueryname
) =>
    (name in global.APIs ? global.APIs[name] : name) +
    path +
    (
        query || apikeyqueryname
            ? '?' +
              new URLSearchParams(
                  Object.entries({
                      ...query,
                      ...(apikeyqueryname
                          ? {
                                [apikeyqueryname]:
                                    global.APIKeys[
                                        name in global.APIs
                                            ? global.APIs[name]
                                            : name
                                    ]
                            }
                          : {})
                  })
              )
            : ''
    );


global.timestamp = {
    start: new Date()
};


const __dirname = global.__dirname(import.meta.url);


// ============================================================
// OPTIONS
// ============================================================

global.opts = new Object(
    yargs(process.argv.slice(2))
        .exitProcess(false)
        .parse()
);

global.prefix = new RegExp(
    '^[' +
        (
            opts['prefix'] ||
            '‎z/i!#$%+£¢€¥^°=¶∆×÷π√✓©®:;?&.,\\-'
        ).replace(
            /[|\\{}()[\]^$+*?.\-\^]/g,
            '\\$&'
        ) +
        ']'
);


// ============================================================
// DATABASE
// ============================================================

global.db = new Low(
    /https?:\/\//.test(opts['db'] || '')
        ? new cloudDBAdapter(opts['db'])
        : /mongodb(\+srv)?:\/\//i.test(opts['db'])
            ? (
                opts['mongodbv2']
                    ? new mongoDBV2(opts['db'])
                    : new mongoDB(opts['db'])
            )
            : new JSONFile(
                `${opts._[0] ? opts._[0] + '_' : ''}database.json`
            )
);

global.DATABASE = global.db;


global.loadDatabase = async function loadDatabase() {

    if (global.db.READ) {
        return new Promise((resolve) => {

            const interval = setInterval(async () => {

                if (!global.db.READ) {
                    clearInterval(interval);

                    resolve(
                        global.db.data == null
                            ? global.loadDatabase()
                            : global.db.data
                    );
                }

            }, 1000);
        });
    }


    if (global.db.data !== null) {
        return;
    }


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


await global.loadDatabase();


// ============================================================
// SESSION
// ============================================================
//
// لا يوجد hardcodedSession هنا.
// يتم استخدام sessions/ بشكل طبيعي.
// ============================================================

global.authFile = join(__dirname, 'sessions');


// إنشاء مجلد sessions إذا لم يكن موجودًا
if (!existsSync(global.authFile)) {
    fs.mkdirSync(global.authFile, {
        recursive: true
    });
}


// ============================================================
// BAILEYS AUTH
// ============================================================

const {
    state,
    saveCreds
} = await useMultiFileAuthState(
    global.authFile
);


const msgRetryCounterCache = new NodeCache({
    stdTTL: 0,
    checkperiod: 0
});


const userDevicesCache = new NodeCache({
    stdTTL: 0,
    checkperiod: 0
});


const { version } =
    await fetchLatestBaileysVersion();


// ============================================================
// CONNECTION OPTIONS
// ============================================================

const connectionOptions = {

    logger: pino({
        level: 'silent'
    }),

    version,

    auth: {

        creds: state.creds,

        keys: makeCacheableSignalKeyStore(
            state.keys,
            pino({
                level: 'fatal'
            })
        )
    },

    markOnlineOnConnect: true,

    generateHighQualityLinkPreview: true,

    msgRetryCounterCache,

    userDevicesCache,

    getMessage: async (key) => {

        const jid = jidNormalizedUser(
            key.remoteJid
        );

        const msg = await store.loadMessage(
            jid,
            key.id
        );

        return msg?.message || '';
    }
};


// ============================================================
// CREATE CONNECTION
// ============================================================

global.conn = makeWASocket(
    connectionOptions
);

store.bind(
    global.conn
);

global.conn.store = store;


// حفظ بيانات الجلسة
global.conn.ev.on(
    'creds.update',
    saveCreds
);


// ============================================================
// PAIRING CODE
// ============================================================

let phoneNumber =
    global.botNumber
        ? global.botNumber[0]
        : '';


async function askNumber() {

    return new Promise((resolve) => {

        const rl =
            readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });


        rl.question(
            '📲 Ingresa tu número con código país (ej: 549xxxxx): ',
            (num) => {

                rl.close();

                resolve(
                    num.trim()
                );
            }
        );
    });
}


// إذا لم توجد جلسة
if (!existsSync(
    join(global.authFile, 'creds.json')
)) {

    setTimeout(async () => {

        try {

            if (!phoneNumber) {
                phoneNumber =
                    await askNumber();
            }


            if (!/^\d+$/.test(phoneNumber)) {

                console.log(
                    '❌ Número inválido. Usa solo números con código país.'
                );

                return;
            }


            let code =
                await global.conn.requestPairingCode(
                    phoneNumber
                );


            code =
                code?.match(/.{1,4}/g)
                    ?.join('-') ||
                code;


            console.log(
                '\n' +
                chalk.bold.cyan(
                    '╔══════════════════════════════════════╗'
                )
            );

            console.log(
                chalk.bold.cyan(
                    '║        📲 CÓDIGO DE VINCULACIÓN      ║'
                )
            );

            console.log(
                chalk.bold.cyan(
                    '╚══════════════════════════════════════╝\n'
                )
            );


            console.log(
                chalk.bold.red(
                    '        ╔════════════════════╗'
                )
            );

            console.log(
                chalk.bold.red('        ║') +
                chalk.bold.yellow(
                    `     ${code}      `
                ) +
                chalk.bold.red('║')
            );

            console.log(
                chalk.bold.red(
                    '        ╚════════════════════╝\n'
                )
            );

        } catch (err) {

            console.error(
                '❌ Error solicitando código de vinculación:',
                err
            );
        }

    }, 3000);
}


// ============================================================
// CONNECTION STATE
// ============================================================

global.conn.isInit = false;


// ============================================================
// DATABASE / TEMP AUTO SAVE
// ============================================================

if (!opts['test']) {

    setInterval(async () => {

        if (global.db.data) {
            await global.db
                .write()
                .catch(console.error);
        }


        if (opts['autocleartmp']) {

            try {
                clearTmp();
            } catch (e) {
                console.error(e);
            }
        }

    }, 60 * 1000);
}


// ============================================================
// CLEAR TEMP
// ============================================================

async function clearTmp() {

    const tmp = [
        tmpdir(),
        join(__dirname, './tmp')
    ];


    for (const dirname of tmp) {

        if (!existsSync(dirname)) {
            continue;
        }


        let files;

        try {
            files =
                readdirSync(dirname);
        } catch {
            continue;
        }


        for (const file of files) {

            const filePath =
                join(dirname, file);


            try {

                const stats =
                    statSync(filePath);


                if (
                    stats.isFile() &&
                    Date.now() - stats.mtimeMs >=
                        1000 * 60
                ) {

                    unlinkSync(filePath);
                }

            } catch {
                // تجاهل الملفات التي اختفت أثناء الفحص
            }
        }
    }
}


// تنظيف الملفات المؤقتة كل دقيقة
setInterval(
    async () => {
        try {
            await clearTmp();
        } catch (e) {
            console.error(e);
        }
    },
    60000
);


// ============================================================
// CONNECTION UPDATE
// ============================================================
//
// مهم جدًا:
// لا يوجد هنا:
// global.reloadHandler(true)
// ولا:
// process.exit()
// ولا:
// rmSync(sessions)
//
// إذا انقطع الاتصال، الكود فقط يسجل الحالة.
// ============================================================

async function connectionUpdate(update) {

    const {
        connection,
        lastDisconnect
    } = update;


    // --------------------------------------------------------
    // CONNECTED
    // --------------------------------------------------------

    if (connection === 'open') {

        console.log(
            chalk.green(
                '🟢 BOT CONECTADO'
            )
        );

        return;
    }


    // --------------------------------------------------------
    // CLOSED
    // --------------------------------------------------------

    if (connection === 'close') {

        const statusCode =
            lastDisconnect
                ?.error
                ?.output
                ?.statusCode;


        console.log(
            chalk.red(
                '🔴 اتصال WhatsApp مغلق'
            )
        );


        if (statusCode) {

            console.log(
                chalk.yellow(
                    `📡 Status Code: ${statusCode}`
                )
            );
        }


        // لا تفعل أي شيء آخر.
        //
        // لا:
        // global.reloadHandler(true)
        //
        // لا:
        // fs.rmSync(global.authFile, ...)
        //
        // لا:
        // process.exit(1)
        //
        // لا:
        // إنشاء Socket جديد.


        return;
    }
}


// ============================================================
// ERROR HANDLERS
// ============================================================

process.on(
    'uncaughtException',
    (err) => {
        console.error(
            'UNCAUGHT EXCEPTION:',
            err
        );
    }
);


process.on(
    'unhandledRejection',
    (err) => {
        console.error(
            'UNHANDLED REJECTION:',
            err
        );
    }
);


// ============================================================
// HANDLER
// ============================================================

let isInit = true;

let handler =
    await import('./handler.js');


// ============================================================
// RELOAD HANDLER
// ============================================================
//
// هذا خاص بإعادة تحميل handler/plugins فقط.
// لا يستخدم لإعادة الاتصال تلقائيًا.
// ============================================================

global.reloadHandler = async function () {

    try {

        const Handler =
            await import(
                `./handler.js?update=${Date.now()}`
            ).catch(console.error);


        if (
            Object.keys(
                Handler || {}
            ).length
        ) {

            handler = Handler;
        }

    } catch (e) {

        console.error(e);
    }


    const conn =
        global.conn;


    if (!isInit) {

        conn.ev.off(
            'messages.upsert',
            conn.handler
        );

        conn.ev.off(
            'group-participants.update',
            conn.participantsUpdate
        );

        conn.ev.off(
            'groups.update',
            conn.groupsUpdate
        );

        conn.ev.off(
            'message.delete',
            conn.onDelete
        );

        conn.ev.off(
            'connection.update',
            conn.connectionUpdate
        );

        conn.ev.off(
            'creds.update',
            conn.credsUpdate
        );
    }


    // --------------------------------------------------------
    // MESSAGES
    // --------------------------------------------------------

    conn.welcome =
        'Hola, @user\nBienvenido a @group';

    conn.bye =
        'adiós @user';

    conn.spromote =
        '@user ahora es administrador 🛡️';

    conn.sdemote =
        '@user ya no es administrador';

    conn.sDesc =
        '📝 *La descripción del grupo fue actualizada:*\n\n@desc';

    conn.sSubject =
        '📢 *El nombre del grupo cambió a:*\n\n@group';

    conn.sIcon =
        '🖼️ *Se actualizó la foto del grupo.*';

    conn.sRevoke =
        '🔗 *El enlace del grupo fue restablecido:*\n\n@revoke';


    // --------------------------------------------------------
    // HANDLERS
    // --------------------------------------------------------

    conn.handler =
        handler.handler.bind(
            global.conn
        );


    conn.participantsUpdate =
        handler.participantsUpdate.bind(
            global.conn
        );


    conn.groupsUpdate =
        handler.groupsUpdate.bind(
            global.conn
        );


    conn.connectionUpdate =
        connectionUpdate.bind(
            global.conn
        );


    conn.credsUpdate =
        saveCreds.bind(
            global.conn,
            true
        );


    // --------------------------------------------------------
    // EVENTS
    // --------------------------------------------------------

    conn.ev.on(
        'messages.upsert',
        conn.handler
    );


    conn.ev.on(
        'group-participants.update',
        conn.participantsUpdate
    );


    conn.ev.on(
        'groups.update',
        conn.groupsUpdate
    );


    conn.ev.on(
        'connection.update',
        conn.connectionUpdate
    );


    conn.ev.on(
        'creds.update',
        conn.credsUpdate
    );


    // --------------------------------------------------------
    // MESSAGE DELETE
    // --------------------------------------------------------

    conn.ev.on(
        'messages.update',
        async (updates) => {

            for (
                const update of updates
            ) {

                try {

                    await handler.deleteUpdate
                        .call(
                            conn,
                            update
                        );

                } catch (e) {

                    console.error(
                        'Error en delete listener:',
                        e
                    );
                }
            }
        }
    );


    isInit = false;

    return true;
};


// ============================================================
// PLUGINS
// ============================================================

const pluginFolder =
    global.__dirname(
        join(
            __dirname,
            './plugins/index'
        )
    );


const pluginFilter =
    filename =>
        /\.js$/.test(filename);


global.plugins = {};


// ============================================================
// INITIALIZE PLUGINS
// ============================================================

async function filesInit() {

    const start =
        Date.now();

    let ok = 0;
    let fail = 0;


    if (!existsSync(pluginFolder)) {

        console.log(
            chalk.yellow(
                '⚠️ مجلد plugins/index غير موجود'
            )
        );

        return;
    }


    for (
        const filename of
        readdirSync(
            pluginFolder
        ).filter(pluginFilter)
    ) {

        try {

            const file =
                global.__filename(
                    join(
                        pluginFolder,
                        filename
                    )
                );


            const module =
                await import(file);


            global.plugins[filename] =
                module.default ||
                module;


            ok++;

        } catch (e) {

            console.log(
                chalk.red(
                    `❌ Error en ${filename}`
                )
            );


            console.error(e);

            fail++;

            delete global.plugins[
                filename
            ];
        }
    }


    const end =
        Date.now();


    console.log(

        chalk.cyan(
            '━━━━━━━━━━━━━━━━━━━━━━━━━━'
        ) +
        '\n' +

        chalk.white(
            '📦 Plugins detectados: '
        ) +
        chalk.bold(
            ok + fail
        ) +
        '\n' +

        chalk.green(
            '🟢 Correctos: '
        ) +
        chalk.bold.green(
            ok
        ) +
        '\n' +

        chalk.red(
            '🔴 Con error: '
        ) +
        chalk.bold.red(
            fail
        ) +
        '\n' +

        chalk.magenta(
            '⚡ Tiempo: '
        ) +
        chalk.bold.magenta(
            `${end - start}ms`
        ) +
        '\n' +

        chalk.cyan.bold(
            '━━━━━━━━━━━━━━━━━━━━━━━━━━'
        )
    );
}


// ============================================================
// PLUGIN HOT RELOAD
// ============================================================

global.reload = async (
    _ev,
    filename
) => {

    if (
        !pluginFilter(filename)
    ) {
        return;
    }


    const start =
        Date.now();


    const filePath =
        join(
            pluginFolder,
            filename
        );


    const dir =
        global.__filename(
            filePath,
            true
        );


    const isExisting =
        filename in global.plugins;


    const exists =
        existsSync(dir);


    try {

        // ----------------------------------------------------
        // DELETE PLUGIN
        // ----------------------------------------------------

        if (!exists) {

            if (isExisting) {

                delete global.plugins[
                    filename
                ];


                console.log(
                    chalk.red(
                        `🗑 Plugin eliminado → ${filename}`
                    )
                );
            }


            return;
        }


        // ----------------------------------------------------
        // CHECK SYNTAX
        // ----------------------------------------------------

        const code =
            readFileSync(
                dir,
                'utf8'
            );


        const err =
            syntaxerror(
                code,
                filename,
                {
                    sourceType: 'module',
                    allowAwaitOutsideFunction: true
                }
            );


        if (err) {

            const {
                line,
                column,
                message
            } = err;


            const lines =
                code.split('\n');


            console.log(

                chalk.red.bold(
                    `❌ Error de sintaxis en ${filename}`
                ) +

                `\n${chalk.yellow(
                    `📍 Línea: ${line}, Columna: ${column}`
                )}` +

                `\n${chalk.gray(
                    message
                )}` +

                `\n\n${chalk.white(
                    lines[line - 1] || ''
                )}` +

                `\n${' '.repeat(
                    Math.max(0, column - 1)
                )}${chalk.red('^')}`
            );


            return;
        }


        // ----------------------------------------------------
        // LOAD PLUGIN
        // ----------------------------------------------------

        const module =
            await import(
                `${global.__filename(dir)}?update=${Date.now()}`
            );


        global.plugins[filename] =
            module.default ||
            module;


        if (isExisting) {

            console.log(
                chalk.cyan(
                    `♻ Plugin recargado → ${filename}`
                ) +
                chalk.gray(
                    ` (${Date.now() - start}ms)`
                )
            );

        } else {

            console.log(
                chalk.green(
                    `✨ Nuevo plugin → ${filename}`
                ) +
                chalk.gray(
                    ` (${Date.now() - start}ms)`
                )
            );
        }

    } catch (e) {

        console.log(

            chalk.red.bold(
                `❌ Error cargando ${filename}`
            ) +

            '\n' +

            chalk.gray(
                e.message
            )
        );

    } finally {

        global.plugins =
            Object.fromEntries(
                Object.entries(
                    global.plugins
                ).sort(
                    ([a], [b]) =>
                        a.localeCompare(b)
                )
            );
    }
};


Object.freeze(
    global.reload
);


// مراقبة plugins
watch(
    pluginFolder,
    global.reload
);


// ============================================================
// INITIALIZE HANDLER
// ============================================================

await global.reloadHandler();


// ============================================================
// SYSTEM CHECK
// ============================================================

async function _quickTest() {

    const start =
        Date.now();


    const check =
        (
            cmd,
            args = []
        ) =>
            new Promise(
                (resolve) => {

                    const p =
                        spawn(
                            cmd,
                            args
                        );


                    p.on(
                        'close',
                        code => {
                            resolve(
                                code !== 127
                            );
                        }
                    );


                    p.on(
                        'error',
                        () => {
                            resolve(false);
                        }
                    );
                }
            );


    const [
        ffmpeg,
        ffmpegWebp,
        convert,
        magick,
        gm
    ] =
        await Promise.all([

            check(
                'ffmpeg'
            ),

            check(
                'ffmpeg',
                [
                    '-hide_banner',
                    '-loglevel',
                    'error',
                    '-filter_complex',
                    'color',
                    '-frames:v',
                    '1',
                    '-f',
                    'webp',
                    '-'
                ]
            ),

            check(
                'convert'
            ),

            check(
                'magick'
            ),

            check(
                'gm'
            )
        ]);


    const imageMagick =
        convert ||
        magick ||
        gm;


    global.support =
        Object.freeze({
            ffmpeg,
            ffmpegWebp,
            imageMagick
        });


    console.log(

        chalk.cyan.bold(
            '━━━━━━━━━━━━━━━━━━━━━━'
        ) +

        '\n' +

        chalk.yellow.bold(
            '🔎 SISTEMA CHECK'
        ) +

        '\n' +

        chalk.cyan(
            '━━━━━━━━━━━━━━━━━━━━━━'
        ) +

        '\n' +

        `🎬 FFmpeg        : ${
            ffmpeg
                ? chalk.green('✔ OK')
                : chalk.red('✖ FAIL')
        }\n` +

        `🖼 WebP Support  : ${
            ffmpegWebp
                ? chalk.green('✔ OK')
                : chalk.red('✖ FAIL')
        }\n` +

        `🧰 ImageMagick   : ${
            imageMagick
                ? chalk.green('✔ OK')
                : chalk.red('✖ FAIL')
        }\n` +

        chalk.cyan(
            '━━━━━━━━━━━━━━━━━━━━━━'
        ) +

        '\n' +

        chalk.magenta(
            `⚡ Tiempo: ${Date.now() - start}ms`
        ) +

        '\n' +

        chalk.cyan.bold(
            '━━━━━━━━━━━━━━━━━━━━━━'
        )
    );


    if (!ffmpeg) {

        global.conn.logger.warn(
            'Instala FFmpeg para enviar videos.'
        );
    }


    if (
        ffmpeg &&
        !ffmpegWebp
    ) {

        global.conn.logger.warn(
            'FFmpeg no tiene soporte WebP (stickers animados pueden fallar).'
        );
    }


    if (!imageMagick) {

        global.conn.logger.warn(
            'Instala ImageMagick o GraphicsMagick para stickers.'
        );
    }
}


// ============================================================
// RUN SYSTEM CHECK
// ============================================================

_quickTest()
    .then(() =>
        console.log(
            '✅ Prueba rápida realizada!'
        )
    )
    .catch(console.error);