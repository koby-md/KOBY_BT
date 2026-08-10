import './config.js';

import { createRequire } from 'module';
import path, { join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { platform } from 'process';

import * as ws from 'ws';
import chalk from 'chalk';

import {
    readdirSync,
    statSync,
    unlinkSync,
    existsSync,
    readFileSync,
    watch,
    rmSync,
    mkdirSync
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

const {
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    jidNormalizedUser
} = await import('@whiskeysockets/baileys');

import moment from 'moment-timezone';
import NodeCache from 'node-cache';

const { chain } = lodash;


// ============================================================
// GLOBALS
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
    return path.dirname(
        global.__filename(pathURL, true)
    );
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
    (name in global.APIs
        ? global.APIs[name]
        : name) +
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

global.connectionRetries = 0;

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
        : /mongodb(\+srv)?:\/\//i.test(
              opts['db']
          )
        ? opts['mongodbv2']
            ? new mongoDBV2(opts['db'])
            : new mongoDB(opts['db'])
        : new JSONFile(
              `${opts._[0] ? opts._[0] + '_' : ''}database.json`
          )
);

global.DATABASE = global.db;

global.loadDatabase = async function loadDatabase() {
    if (global.db.READ) {
        return new Promise(resolve =>
            setInterval(async function () {
                if (!global.db.READ) {
                    clearInterval(this);

                    resolve(
                        global.db.data == null
                            ? global.loadDatabase()
                            : global.db.data
                    );
                }
            }, 1000)
        );
    }

    if (global.db.data !== null) {
        return;
    }

    global.db.READ = true;

    await global.db
        .read()
        .catch(console.error);

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

    global.db.chain = chain(
        global.db.data
    );
};

loadDatabase();


// ============================================================
// SESSION
// ============================================================

global.authFile = join(
    __dirname,
    'sessions'
);

if (!existsSync(global.authFile)) {
    mkdirSync(
        global.authFile,
        {
            recursive: true
        }
    );
}


// ============================================================
// SESSION FLAGS
// ============================================================

let pairingRequested = false;
let sessionResetting = false;
let socketInitialized = false;


// ============================================================
// DELETE SESSION
// ============================================================

function removeSession() {

    try {

        if (existsSync(global.authFile)) {

            rmSync(
                global.authFile,
                {
                    recursive: true,
                    force: true
                }
            );

        }

        mkdirSync(
            global.authFile,
            {
                recursive: true
            }
        );

        console.log(
            chalk.yellow(
                '🗑️ تم حذف الجلسة القديمة بالكامل.'
            )
        );

    } catch (error) {

        console.error(
            chalk.red(
                '❌ خطأ أثناء حذف الجلسة:'
            ),
            error
        );

    }
}


// ============================================================
// CREATE SOCKET
// ============================================================

async function createConnection() {

    const authState =
        await useMultiFileAuthState(
            global.authFile
        );

    const { state, saveCreds } =
        authState;

    const {
        version
    } =
        await fetchLatestBaileysVersion();

    const msgRetryCounterCache =
        new NodeCache({
            stdTTL: 0,
            checkperiod: 0
        });

    const userDevicesCache =
        new NodeCache({
            stdTTL: 0,
            checkperiod: 0
        });

    const connectionOptions = {

        logger: pino({
            level: 'silent'
        }),

        version,

        auth: {

            creds: state.creds,

            keys:
                makeCacheableSignalKeyStore(
                    state.keys,
                    pino({
                        level: 'fatal'
                    })
                )
        },

        markOnlineOnConnect: true,

        generateHighQualityLinkPreview:
            true,

        msgRetryCounterCache,

        userDevicesCache,

        getMessage: async key => {

            const jid =
                jidNormalizedUser(
                    key.remoteJid
                );

            const msg =
                await store.loadMessage(
                    jid,
                    key.id
                );

            return (
                msg?.message || ''
            );
        }
    };


    // إذا كان هناك Socket قديم
    // لا نستخدمه مرة أخرى
    if (global.conn) {

        try {
            global.conn.ws.close();
        } catch {}

        try {
            global.conn.ev.removeAllListeners();
        } catch {}
    }


    global.conn =
        makeWASocket(
            connectionOptions
        );

    store.bind(
        global.conn
    );

    global.conn.store =
        store;


    global.conn.ev.on(
        'creds.update',
        saveCreds
    );


    socketInitialized = true;


    return {
        conn: global.conn,
        saveCreds
    };
}


// ============================================================
// PAIRING CODE
// ============================================================

async function requestPairingCodeOnce() {

    if (pairingRequested) {

        console.log(
            chalk.yellow(
                '⚠️ تم طلب Pairing Code مسبقًا.'
            )
        );

        return;
    }

    pairingRequested = true;


    try {

        let phoneNumber =
            global.botNumber
                ? global.botNumber[0]
                : '';


        if (!phoneNumber) {

            const rl =
                readline.createInterface({
                    input: process.stdin,
                    output: process.stdout
                });


            phoneNumber =
                await new Promise(
                    resolve => {

                        rl.question(
                            '📲 Ingresa tu número con código país (ej: 549xxxxx): ',
                            number => {

                                rl.close();

                                resolve(
                                    number.trim()
                                );
                            }
                        );
                    }
                );
        }


        phoneNumber =
            String(phoneNumber)
                .replace(/\D/g, '');


        if (!phoneNumber) {

            console.log(
                chalk.red(
                    '❌ Número inválido.'
                )
            );

            process.exit(1);
        }


        console.log(
            chalk.cyan(
                '📲 Generando Pairing Code...'
            )
        );


        const code =
            await global.conn.requestPairingCode(
                phoneNumber
            );


        const formattedCode =
            code?.match(/.{1,4}/g)
                ?.join('-') ||
            code;


        console.log('');

        console.log(
            chalk.cyan(
                '╔══════════════════════════════════════╗'
            )
        );

        console.log(
            chalk.cyan(
                '║        📲 CÓDIGO DE VINCULACIÓN      ║'
            )
        );

        console.log(
            chalk.cyan(
                '╚══════════════════════════════════════╝'
            )
        );

        console.log('');

        console.log(
            chalk.yellow.bold(
                `             ${formattedCode}`
            )
        );

        console.log('');

        console.log(
            chalk.green(
                '➡️ أدخل هذا الكود في WhatsApp.'
            )
        );

        console.log('');

    } catch (error) {

        console.error(
            chalk.red(
                '❌ فشل إنشاء Pairing Code:'
            ),
            error?.message || error
        );

        process.exit(1);
    }
}


// ============================================================
// CONNECTION UPDATE
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

        global.connectionRetries = 0;

        pairingRequested = false;

        sessionResetting = false;

        console.log(
            chalk.green.bold(
                '🟢 BOT CONECTADO'
            )
        );

        return;
    }


    // --------------------------------------------------------
    // CLOSED
    // --------------------------------------------------------

    if (connection !== 'close') {
        return;
    }


    const statusCode =
        lastDisconnect
            ?.error
            ?.output
            ?.statusCode;


    console.log(
        chalk.yellow(
            `⚠️ الاتصال مغلق. Status: ${
                statusCode ?? 'unknown'
            }`
        )
    );


    // ========================================================
    // INVALID SESSION
    // ========================================================

    const invalidSession =
        statusCode ===
            DisconnectReason.loggedOut ||

        statusCode ===
            DisconnectReason.badSession;


    if (invalidSession) {


        if (sessionResetting) {

            console.log(
                chalk.yellow(
                    '⚠️ عملية إعادة إنشاء الجلسة قيد التنفيذ بالفعل.'
                )
            );

            return;
        }


        sessionResetting = true;


        console.log(
            chalk.red.bold(
                '❌ الجلسة الحالية غير صالحة.'
            )
        );


        // لا retry
        // لا reloadHandler(true)
        // حذف الجلسة مباشرة

        removeSession();


        try {

            const result =
                await createConnection();


            console.log(
                chalk.green(
                    '🔄 تم إنشاء جلسة WhatsApp جديدة.'
                )
            );


            // Pairing Code مرة واحدة فقط

            await requestPairingCodeOnce();


        } catch (error) {

            console.error(
                chalk.red(
                    '❌ فشل إنشاء جلسة جديدة:'
                ),
                error
            );

            process.exit(1);
        }


        return;
    }


    // ========================================================
    // OTHER DISCONNECT
    // ========================================================

    console.log(
        chalk.red(
            '🛑 تم إغلاق الاتصال.'
        )
    );

    console.log(
        chalk.yellow(
            '🚫 لن تتم إعادة محاولة الاتصال تلقائيًا.'
        )
    );


    process.exit(1);
}


// ============================================================
// INIT CONNECTION
// ============================================================

const initialConnection =
    await createConnection();

global.conn =
    initialConnection.conn;


// ============================================================
// HANDLER
// ============================================================

conn.isInit = false;

let isInit = true;

let handler =
    await import(
        './handler.js'
    );


global.reloadHandler =
    async function reloadHandler(
        restatConn = false
    ) {

        try {

            const Handler =
                await import(
                    `./handler.js?update=${Date.now()}`
                );

            if (
                Object.keys(
                    Handler || {}
                ).length
            ) {

                handler = Handler;
            }

        } catch (error) {

            console.error(
                error
            );
        }


        // مهم:
        // reloadHandler لم يعد يعيد تشغيل
        // Socket تلقائيًا.

        if (restatConn) {

            console.log(
                chalk.yellow(
                    '⚠️ إعادة إنشاء Socket ممنوعة من نظام الجلسة.'
                )
            );

            return false;
        }


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
            initialConnection.saveCreds.bind(
                global.conn,
                true
            );


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


        conn.ev.on(
            'messages.update',
            async updates => {

                for (
                    const update of updates
                ) {

                    try {

                        await handler.deleteUpdate
                            .call(
                                conn,
                                update
                            );

                    } catch (error) {

                        console.error(
                            'Error en delete listener:',
                            error
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


async function filesInit() {

    const start =
        Date.now();

    let ok = 0;
    let fail = 0;


    for (
        const filename of
        readdirSync(
            pluginFolder
        ).filter(
            pluginFilter
        )
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


            global.plugins[
                filename
            ] =
                module.default ||
                module;


            ok++;


        } catch (error) {

            console.log(
                chalk.red(
                    `❌ Error en ${filename}`
                )
            );

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


await filesInit();


// ============================================================
// DATABASE SAVE / TMP
// ============================================================

if (!opts['test']) {

    setInterval(
        async () => {

            if (global.db.data) {

                await global.db
                    .write()
                    .catch(
                        console.error
                    );
            }

            if (
                opts['autocleartmp']
            ) {

                try {

                    clearTmp();

                } catch (error) {

                    console.error(
                        error
                    );
                }
            }

        },
        60 * 1000
    );
}


async function clearTmp() {

    const tmp = [
        tmpdir(),
        join(
            __dirname,
            './tmp'
        )
    ];

    const filename = [];


    for (
        const dirname of tmp
    ) {

        if (!existsSync(dirname)) {
            continue;
        }


        for (
            const file of
            readdirSync(dirname)
        ) {

            filename.push(
                join(
                    dirname,
                    file
                )
            );
        }
    }


    return filename.map(
        file => {

            try {

                const stats =
                    statSync(file);


                if (
                    stats.isFile() &&
                    (
                        Date.now() -
                        stats.mtimeMs >=
                        1000 * 60
                    )
                ) {

                    return unlinkSync(
                        file
                    );
                }

            } catch {}


            return false;
        }
    );
}


setInterval(
    async () => {

        await clearTmp();

    },
    60000
);


// ============================================================
// PLUGIN HOT RELOAD
// ============================================================

global.reload =
    async (_ev, filename) => {

        if (
            !pluginFilter(
                filename
            )
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
            filename in
            global.plugins;


        const exists =
            existsSync(dir);


        try {

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
                        sourceType:
                            'module',
                        allowAwaitOutsideFunction:
                            true
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
                        lines[line - 1]
                    )}` +

                    `\n${' '.repeat(
                        Math.max(
                            0,
                            column - 1
                        )
                    )}${chalk.red('^')}`
                );


                return;
            }


            const module =
                await import(
                    `${global.__filename(
                        dir
                    )}?update=${Date.now()}`
                );


            global.plugins[
                filename
            ] =
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


        } catch (error) {

            console.log(
                chalk.red.bold(
                    `❌ Error cargando ${filename}`
                ) +
                '\n' +
                chalk.gray(
                    error.message
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


watch(
    pluginFolder,
    global.reload
);


// ============================================================
// INITIAL HANDLER
// ============================================================

await global.reloadHandler();


// ============================================================
// ERROR HANDLERS
// ============================================================

process.on(
    'uncaughtException',
    error => {

        console.error(
            'UNCAUGHT EXCEPTION:',
            error
        );
    }
);


process.on(
    'unhandledRejection',
    error => {

        console.error(
            'UNHANDLED:',
            error
        );
    }
);


// ============================================================
// QUICK TEST
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
                resolve => {

                    const p =
                        spawn(
                            cmd,
                            args
                        );


                    p.on(
                        'close',
                        code =>
                            resolve(
                                code !== 127
                            )
                    );


                    p.on(
                        'error',
                        () =>
                            resolve(false)
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

        conn.logger.warn(
            'Instala FFmpeg para enviar videos.'
        );
    }


    if (
        ffmpeg &&
        !ffmpegWebp
    ) {

        conn.logger.warn(
            'FFmpeg no tiene soporte WebP.'
        );
    }


    if (!imageMagick) {

        conn.logger.warn(
            'Instala ImageMagick o GraphicsMagick para stickers.'
        );
    }
}


// ============================================================
// START
// ============================================================

_quickTest()
    .then(
        () =>
            console.log(
                '✅ Prueba rápida realizada!'
            )
    )
    .catch(
        console.error
    );