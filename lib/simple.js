import path from 'path'
import { toAudio } from './converter.js'
import chalk from 'chalk'
import fetch from 'node-fetch'
import PhoneNumber from 'awesome-phonenumber'
import fs from 'fs'
import util from 'util'
import { fileTypeFromBuffer } from 'file-type'
import { format } from 'util'
import { fileURLToPath } from 'url'
import store from './store.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * @type {import('@whiskeysockets/baileys')}
 */
const baileys = await import('@whiskeysockets/baileys')

const {
    default: _makeWaSocket,
    makeWALegacySocket,
    proto,
    downloadContentFromMessage,
    jidDecode,
    areJidsSameUser,
    generateForwardMessageContent,
    generateWAMessageFromContent,
    WAMessageStubType,
    extractMessageContent,
    prepareWAMessageMedia
} = baileys


/* =========================================================
 * LID HELPERS
 * ========================================================= */

/**
 * تنظيف JID بدون تحويل LID إلى PN
 * مثال:
 * 12345:0@s.whatsapp.net -> 12345@s.whatsapp.net
 * 12345:0@lid           -> 12345@lid
 */
function normalizeJid(jid) {
    if (!jid || typeof jid !== 'string') return jid

    jid = jid.trim()

    if (!jid) return jid

    if (/:/.test(jid)) {
        const decoded = jidDecode(jid)

        if (decoded?.user && decoded?.server) {
            return `${decoded.user}@${decoded.server}`
        }
    }

    return jid
}


/**
 * واش JID هو LID
 */
function isLidJid(jid) {
    return typeof jid === 'string' && jid.endsWith('@lid')
}


/**
 * واش JID رقم عادي
 */
function isPnJid(jid) {
    return typeof jid === 'string' && jid.endsWith('@s.whatsapp.net')
}


/**
 * تنظيف رقم من JID
 */
function jidToNumber(jid) {
    if (!jid) return null

    const normalized = normalizeJid(jid)

    return normalized
        ?.split('@')[0]
        ?.split(':')[0] || null
}


export function makeWASocket(connectionOptions, options = {}) {

    /**
     * @type {import('@whiskeysockets/baileys').WASocket | import('@whiskeysockets/baileys').WALegacySocket}
     */
    let conn = (global.opts['legacy'] ? makeWALegacySocket : _makeWaSocket)(connectionOptions)


    let sock = Object.defineProperties(conn, {

        chats: {
            value: { ...(options.chats || {}) },
            writable: true
        },


        logger: {
            get() {
                return {
                    info(...args) {
                        console.log(
                            chalk.bold.bgRgb(51, 204, 51)('INFO '),
                            `[${chalk.rgb(255, 255, 255)(new Date().toUTCString())}]:`,
                            chalk.cyan(format(...args))
                        )
                    },

                    error(...args) {
                        console.log(
                            chalk.bold.bgRgb(247, 38, 33)('ERROR '),
                            `[${chalk.rgb(255, 255, 255)(new Date().toUTCString())}]:`,
                            chalk.rgb(255, 38, 0)(format(...args))
                        )
                    },

                    warn(...args) {
                        console.log(
                            chalk.bold.bgRgb(255, 153, 0)('WARNING '),
                            `[${chalk.rgb(255, 255, 255)(new Date().toUTCString())}]:`,
                            chalk.redBright(format(...args))
                        )
                    },

                    trace(...args) {
                        console.log(
                            chalk.grey('TRACE '),
                            `[${chalk.rgb(255, 255, 255)(new Date().toUTCString())}]:`,
                            chalk.white(format(...args))
                        )
                    },

                    debug(...args) {
                        console.log(
                            chalk.bold.bgRgb(66, 167, 245)('DEBUG '),
                            `[${chalk.rgb(255, 255, 255)(new Date().toUTCString())}]:`,
                            chalk.white(format(...args))
                        )
                    }
                }
            },

            enumerable: true
        },


        /* =====================================================
         * GET FILE
         * ===================================================== */

        getFile: {

            async value(PATH, saveToFile = false) {

                let res, filename

                const data =
                    Buffer.isBuffer(PATH)
                        ? PATH
                        : PATH instanceof ArrayBuffer
                            ? PATH.toBuffer()
                            : /^data:.*?\/.*?;base64,/i.test(PATH)
                                ? Buffer.from(PATH.split`,`[1], 'base64')
                                : /^https?:\/\//.test(PATH)
                                    ? await (res = await fetch(PATH)).buffer()
                                    : fs.existsSync(PATH)
                                        ? (filename = PATH, fs.readFileSync(PATH))
                                        : typeof PATH === 'string'
                                            ? PATH
                                            : Buffer.alloc(0)

                if (!Buffer.isBuffer(data))
                    throw new TypeError('Result is not a buffer')

                const type = await fileTypeFromBuffer(data) || {
                    mime: 'application/octet-stream',
                    ext: '.bin'
                }

                if (
                    data &&
                    saveToFile &&
                    !filename
                ) {
                    filename = path.join(
                        __dirname,
                        '../tmp/' + new Date * 1 + '.' + type.ext
                    )

                    await fs.promises.writeFile(filename, data)
                }

                return {
                    res,
                    filename,
                    ...type,
                    data,

                    deleteFile() {
                        return filename && fs.promises.unlink(filename)
                    }
                }
            },

            enumerable: true
        },


        /* =====================================================
         * SEND FILE
         * ===================================================== */

        sendFile: {

            async value(
                jid,
                path,
                filename = '',
                caption = '',
                quoted = null,
                ptt = false,
                options = {}
            ) {

                let type = await conn.getFile(path, true)

                let {
                    res,
                    data: file,
                    filename: pathFile
                } = type

                if (!file || !file.length)
                    throw '❌ Archivo vacío'

                if (res && res.status !== 200) {
                    try {
                        throw {
                            json: JSON.parse(file.toString())
                        }
                    } catch (e) {
                        if (e.json) throw e.json
                    }
                }

                let opt = { ...options }

                let q = quoted || options.quoted || null

                let mtype = 'document'

                let mimetype =
                    options.mimetype ||
                    type.mime ||
                    'application/octet-stream'


                if (options.asDocument) {
                    mtype = 'document'

                } else if (
                    options.asSticker ||
                    /webp/i.test(mimetype)
                ) {
                    mtype = 'sticker'

                } else if (
                    options.asImage ||
                    /image/i.test(mimetype)
                ) {
                    mtype = 'image'

                } else if (
                    options.asVideo ||
                    /video/i.test(mimetype)
                ) {
                    mtype = 'video'

                } else if (
                    options.asAudio ||
                    /audio/i.test(mimetype)
                ) {
                    mtype = 'audio'
                }


                if (mtype === 'audio') {

                    if (/ogg/i.test(mimetype)) {
                        mimetype = 'audio/ogg; codecs=opus'

                    } else if (/mp4|m4a/i.test(mimetype)) {
                        mimetype = 'audio/mp4'

                    } else {
                        mimetype = 'audio/mpeg'
                    }

                    if (typeof options.ptt !== 'undefined') {
                        opt.ptt = options.ptt
                    } else {
                        opt.ptt = ptt
                    }
                }


                delete opt.asSticker
                delete opt.asDocument
                delete opt.asImage
                delete opt.asVideo
                delete opt.asAudio


                let message = {
                    ...opt,
                    caption: caption || options.caption || '',
                    mimetype,
                    fileName: filename || pathFile || 'file'
                }


                if (Buffer.isBuffer(file)) {
                    message[mtype] = file

                } else if (typeof file === 'string') {
                    message[mtype] = { url: file }

                } else {
                    throw '❌ Tipo de archivo no soportado'
                }


                return await conn.sendMessage(
                    jid,
                    message,
                    { quoted: q }
                )
            },

            enumerable: true
        },


        /* =====================================================
         * CONTACT
         * ===================================================== */

        sendContact: {

            async value(
                jid,
                data,
                quoted,
                options = {}
            ) {

                if (
                    !Array.isArray(data[0]) &&
                    typeof data[0] === 'string'
                ) {
                    data = [data]
                }

                let contacts = []

                for (
                    let [
                        number,
                        name,
                        numberowner,
                        gmail,
                        instagram,
                        onum
                    ] of data
                ) {

                    number = number.replace(/[^0-9]/g, '')

                    let vcard = `
BEGIN:VCARD
VERSION:3.0
N:Sy;Bot;;;
FN:${name}
item.ORG:Creator Bot
item1.TEL;waid=${numberowner}:${numberowner}@s.whatsapp.net
item1.X-ABLabel:${onum}
item2.EMAIL;type=INTERNET:${gmail}
item2.X-ABLabel:Email
item5.URL:${instagram}
item5.X-ABLabel:Website
END:VCARD
                    `.trim()

                    contacts.push({
                        vcard,
                        displayName: name
                    })
                }


                return await conn.sendMessage(
                    jid,
                    {
                        ...options,

                        contacts: {
                            ...options,

                            displayName:
                                contacts.length >= 2
                                    ? `${contacts.length} contactos`
                                    : contacts[0]?.displayName || null,

                            contacts
                        }
                    },

                    {
                        quoted,
                        ...options
                    }
                )
            },

            enumerable: true
        },


        /* =====================================================
         * REPLY
         * ===================================================== */

        reply: {

            value(
                jid,
                text = '',
                quoted,
                options = {}
            ) {

                const isGroup =
                    jid &&
                    jid.endsWith('@g.us')

                const finalQuoted =
                    isGroup
                        ? quoted
                        : null


                return Buffer.isBuffer(text)

                    ? conn.sendFile(
                        jid,
                        text,
                        'file',
                        '',
                        finalQuoted,
                        false,
                        options
                    )

                    : conn.sendMessage(
                        jid,
                        {
                            ...options,
                            text
                        },
                        {
                            quoted: finalQuoted,
                            ...options
                        }
                    )
            }
        },


        /* =====================================================
         * BUTTON
         * ===================================================== */

        sendButton: {

            async value(
                jid,
                text = '',
                footer = '',
                quoted,
                buttons = [],
                options = {}
            ) {

                const dynamicButtons = buttons.map(btn => ({
                    name: 'quick_reply',

                    buttonParamsJson: JSON.stringify({
                        display_text: btn[0],
                        id: btn[1]
                    })
                }))


                const message = {
                    viewOnceMessage: {
                        message: {
                            interactiveMessage: {

                                body: {
                                    text
                                },

                                footer: {
                                    text: footer || ''
                                },

                                header: {
                                    hasMediaAttachment: false
                                },

                                nativeFlowMessage: {
                                    buttons: dynamicButtons
                                }
                            }
                        }
                    }
                }


                const msg =
                    generateWAMessageFromContent(
                        jid,
                        message,
                        { quoted }
                    )


                return await conn.relayMessage(
                    jid,
                    msg.message,
                    {
                        messageId: msg.key.id,
                        ...options
                    }
                )
            }
        },


        /* =====================================================
         * STATUS
         * ===================================================== */

        updateProfileStatus: {

            async value(status) {

                return conn.query({
                    tag: 'iq',

                    attrs: {
                        to: 's.whatsapp.net',
                        type: 'set',
                        xmlns: 'status'
                    },

                    content: [
                        {
                            tag: 'status',
                            attrs: {},
                            content: Buffer.from(status, 'utf-8')
                        }
                    ]
                })
            }
        },


        /* =====================================================
         * PAYMENT
         * ===================================================== */

        sendPayment: {

            async value(
                jid,
                amount,
                currency,
                text = '',
                from,
                options = {}
            ) {

                const requestPaymentMessage = {

                    amount: {
                        currencyCode: currency || 'USD',
                        offset: 0,
                        value: amount || 9.99
                    },

                    expiryTimestamp: 0,

                    amount1000:
                        (amount || 9.99) * 1000,

                    currencyCodeIso4217:
                        currency || 'USD',

                    requestFrom:
                        from || '0@s.whatsapp.net',

                    noteMessage: {
                        extendedTextMessage: {
                            text:
                                text ||
                                'Example Payment Message'
                        }
                    }
                }


                return conn.relayMessage(
                    jid,
                    {
                        requestPaymentMessage
                    },
                    {
                        ...options
                    }
                )
            }
        },


        /* =====================================================
         * LOADING MESSAGE
         * ===================================================== */

        loadingMsg: {

            async value(
                jid,
                loamsg,
                loamsgEdit,
                loadingMessages = [],
                quoted,
                options = {}
            ) {

                let { key } =
                    await conn.sendMessage(
                        jid,
                        {
                            text: loamsg,
                            ...options
                        },
                        { quoted }
                    )


                for (
                    let i = 0;
                    i < loadingMessages.length;
                    i++
                ) {

                    await conn.sendMessage(
                        jid,
                        {
                            text: loadingMessages[i],
                            edit: key,
                            ...options
                        },
                        { quoted }
                    )
                }


                await conn.sendMessage(
                    jid,
                    {
                        text: loamsgEdit,
                        edit: key,
                        ...options
                    },
                    { quoted }
                )
            }
        },


        /* =====================================================
         * CMOD
         * ===================================================== */

        cMod: {

            value(
                jid,
                message,
                text = '',
                sender = conn.user.jid,
                options = {}
            ) {

                if (
                    options.mentions &&
                    !Array.isArray(options.mentions)
                ) {
                    options.mentions = [options.mentions]
                }


                let copy = message.toJSON()

                delete copy.message.messageContextInfo
                delete copy.message.senderKeyDistributionMessage


                let mtype =
                    Object.keys(copy.message)[0]

                let msg =
                    copy.message

                let content =
                    msg[mtype]


                if (typeof content === 'string') {
                    msg[mtype] =
                        text || content

                } else if (content.caption) {
                    content.caption =
                        text || content.caption

                } else if (content.text) {
                    content.text =
                        text || content.text
                }


                if (typeof content !== 'string') {

                    msg[mtype] = {
                        ...content,
                        ...options
                    }

                    msg[mtype].contextInfo = {

                        ...(content.contextInfo || {}),

                        mentionedJid:
                            options.mentions ||
                            content.contextInfo?.mentionedJid ||
                            []
                    }
                }


                if (copy.participant) {
                    sender =
                        copy.participant =
                        sender || copy.participant

                } else if (copy.key.participant) {
                    sender =
                        copy.key.participant =
                        sender || copy.key.participant
                }


                if (
                    copy.key.remoteJid
                        ?.includes('@s.whatsapp.net')
                ) {
                    sender =
                        sender ||
                        copy.key.remoteJid
                }


                copy.key.remoteJid = jid

                copy.key.fromMe =
                    areJidsSameUser(
                        sender,
                        conn.user.id
                    ) || false


                return proto.WebMessageInfo.fromObject(copy)
            },

            enumerable: true
        },


        /* =====================================================
         * COPY / FORWARD
         * ===================================================== */

        copyNForward: {

            async value(
                jid,
                message,
                forwardingScore = true,
                options = {}
            ) {

                let vtype

                if (
                    options.readViewOnce &&
                    message.message
                        ?.viewOnceMessage
                        ?.message
                ) {

                    vtype =
                        Object.keys(
                            message.message
                                .viewOnceMessage
                                .message
                        )[0]

                    delete message.message
                        .viewOnceMessage
                        .message[vtype]
                        .viewOnce


                    message.message =
                        proto.Message.fromObject(
                            JSON.parse(
                                JSON.stringify(
                                    message.message
                                        .viewOnceMessage
                                        .message
                                )
                            )
                        )


                    message.message[vtype]
                        .contextInfo =
                        message.message
                            .viewOnceMessage
                            .contextInfo
                }


                let mtype =
                    Object.keys(message.message)[0]


                let m =
                    generateForwardMessageContent(
                        message,
                        !!forwardingScore
                    )


                let ctype =
                    Object.keys(m)[0]


                if (
                    forwardingScore &&
                    typeof forwardingScore === 'number' &&
                    forwardingScore > 1
                ) {

                    m[ctype]
                        .contextInfo
                        .forwardingScore +=
                        forwardingScore
                }


                m[ctype].contextInfo = {

                    ...(message.message[mtype]
                        .contextInfo || {}),

                    ...(m[ctype].contextInfo || {})
                }


                m =
                    generateWAMessageFromContent(
                        jid,
                        m,
                        {
                            ...options,
                            userJid: conn.user.jid
                        }
                    )


                await conn.relayMessage(
                    jid,
                    m.message,
                    {
                        messageId: m.key.id,
                        additionalAttributes: {
                            ...options
                        }
                    }
                )


                return m
            },

            enumerable: true
        },


        /* =====================================================
         * DOWNLOAD
         * ===================================================== */

        downloadM: {

            async value(
                m,
                type,
                saveToFile
            ) {

                let filename

                if (
                    !m ||
                    !(m.url || m.directPath)
                ) {
                    return Buffer.alloc(0)
                }


                const stream =
                    await downloadContentFromMessage(
                        m,
                        type
                    )


                let buffer = Buffer.from([])


                for await (const chunk of stream) {
                    buffer = Buffer.concat([
                        buffer,
                        chunk
                    ])
                }


                if (saveToFile) {
                    ({ filename } =
                        await conn.getFile(
                            buffer,
                            true
                        ))
                }


                return saveToFile &&
                    fs.existsSync(filename)
                    ? filename
                    : buffer
            },

            enumerable: true
        },


        /* =====================================================
         * FAKE REPLY
         * ===================================================== */

        fakeReply: {

            value(
                jid,
                text = '',
                fakeJid = conn.user?.jid,
                fakeText = '',
                fakeGroupJid,
                options = {}
            ) {

                return conn.reply(
                    jid,
                    text,
                    {
                        key: {
                            fromMe:
                                areJidsSameUser(
                                    fakeJid,
                                    conn.user.id
                                ),

                            participant: fakeJid,

                            ...(fakeGroupJid
                                ? {
                                    remoteJid:
                                        fakeGroupJid
                                }
                                : {})
                        },

                        message: {
                            conversation: fakeText
                        },

                        ...options
                    }
                )
            }
        },


        /* =====================================================
         * MENTION
         * ===================================================== */

        parseMention: {

            value(text = '') {

                return [
                    ...text.matchAll(
                        /@([0-9]{5,16}|0)/g
                    )
                ].map(
                    v =>
                        v[1] +
                        '@s.whatsapp.net'
                )
            },

            enumerable: true
        },


        /* =====================================================
         * LID CACHE
         *
         * هنا هو الإصلاح الأساسي
         * ===================================================== */

        isLid: {

            value: new Map(),

            writable: true,

            enumerable: true
        },


        /* =====================================================
         * NORMALIZE / DECODE JID
         *
         * مهم:
         * decodeJid لا يحاول تحويل LID بشكل async.
         * فقط ينظف device suffix.
         * ===================================================== */

        decodeJid: {

            value(jid) {

                return normalizeJid(jid)
            },

            enumerable: true
        },


        /* =====================================================
         * RESOLVE LID
         *
         * LID -> 123456789@s.whatsapp.net
         * ===================================================== */

        getJid: {

            async value(sender) {

                if (!sender)
                    return sender


                let jid =
                    conn.decodeJid(sender)


                /*
                 * إذا كان PN أو Group أو Broadcast
                 * رجعو مباشرة
                 */
                if (!isLidJid(jid)) {
                    return jid
                }


                /*
                 * 1. Cache
                 */
                const cached =
                    conn.isLid.get(jid)

                if (
                    cached &&
                    isPnJid(cached)
                ) {
                    return cached
                }


                /*
                 * 2. signalRepository
                 *
                 * هذه هي الطريقة الأساسية
                 */
                try {

                    const pn =
                        await conn
                            .signalRepository
                            ?.lidMapping
                            ?.getPNForLID(jid)


                    if (
                        pn &&
                        isPnJid(pn)
                    ) {

                        conn.isLid.set(
                            jid,
                            pn
                        )

                        return pn
                    }

                } catch (e) {
                    // تجاهل الخطأ ونستعمل fallback
                }


                /*
                 * 3. البحث في chats metadata
                 */
                try {

                    for (
                        const chat of Object.values(
                            conn.chats || {}
                        )
                    ) {

                        const participants =
                            chat?.metadata
                                ?.participants


                        if (
                            !Array.isArray(
                                participants
                            )
                        ) {
                            continue
                        }


                        const participant =
                            participants.find(p => {

                                const pLid =
                                    normalizeJid(
                                        p?.lid
                                    )

                                const pId =
                                    normalizeJid(
                                        p?.id
                                    )

                                const pJid =
                                    normalizeJid(
                                        p?.jid
                                    )

                                return (
                                    pLid === jid ||
                                    pId === jid ||
                                    pJid === jid
                                )
                            })


                        if (!participant)
                            continue


                        const resolved =
                            normalizeJid(
                                participant?.phoneNumber ||
                                participant?.jid ||
                                participant?.id
                            )


                        if (
                            resolved &&
                            isPnJid(resolved)
                        ) {

                            conn.isLid.set(
                                jid,
                                resolved
                            )

                            return resolved
                        }
                    }

                } catch (e) {
                    // ignore
                }


                /*
                 * لم يتم حل LID
                 * رجع LID كما هو
                 */
                return jid
            },

            enumerable: true
        },


        /* =====================================================
         * GET NUMBER
         * ===================================================== */

        getNum: {

            async value(
                jid,
                chatId = null
            ) {

                if (!jid)
                    return null


                jid =
                    conn.decodeJid(jid)


                let realJid = jid


                /*
                 * LID
                 */
                if (isLidJid(jid)) {

                    /*
                     * 1. Cache
                     */
                    const cached =
                        conn.isLid.get(jid)


                    if (
                        cached &&
                        isPnJid(cached)
                    ) {

                        realJid = cached

                    } else {

                        /*
                         * 2. signalRepository
                         */
                        try {

                            const pn =
                                await conn
                                    .signalRepository
                                    ?.lidMapping
                                    ?.getPNForLID(jid)


                            if (
                                pn &&
                                isPnJid(pn)
                            ) {

                                conn.isLid.set(
                                    jid,
                                    pn
                                )

                                realJid = pn
                            }

                        } catch (e) {
                            // fallback
                        }


                        /*
                         * 3. Group metadata
                         */
                        if (
                            realJid === jid &&
                            chatId
                        ) {

                            try {

                                const metadata =
                                    await conn.groupMetadata(
                                        chatId
                                    )


                                for (
                                    const p of
                                    metadata?.participants ||
                                    []
                                ) {

                                    const pLid =
                                        normalizeJid(
                                            p?.lid
                                        )

                                    const pId =
                                        normalizeJid(
                                            p?.id
                                        )


                                    if (
                                        (
                                            pLid === jid ||
                                            pId === jid
                                        ) &&
                                        p.phoneNumber
                                    ) {

                                        const pn =
                                            normalizeJid(
                                                p.phoneNumber
                                            )


                                        if (
                                            isPnJid(pn)
                                        ) {

                                            conn.isLid.set(
                                                jid,
                                                pn
                                            )

                                            realJid = pn
                                            break
                                        }
                                    }
                                }

                            } catch (e) {
                                // ignore
                            }
                        }
                    }
                }


                /*
                 * رجع الرقم فقط
                 */
                return jidToNumber(realJid)
            },

            enumerable: true
        },


        /* =====================================================
         * GET NAME
         * ===================================================== */

        getName: {

            async value(
                jid = '',
                withoutContact = false
            ) {

                try {

                    jid =
                        conn.decodeJid(jid)


                    /*
                     * Group
                     */
                    if (
                        jid.endsWith('@g.us')
                    ) {

                        let group =
                            conn.chats?.[jid]


                        if (
                            group?.subject
                        ) {
                            return group.subject
                        }


                        let meta =
                            await conn
                                .groupMetadata(jid)
                                .catch(() => null)


                        return (
                            meta?.subject ||
                            'Grupo'
                        )
                    }


                    /*
                     * Bot
                     */
                    if (
                        jid === conn.user?.jid ||
                        jid === conn.user?.id
                    ) {

                        return (
                            conn.user?.name ||
                            'Bot'
                        )
                    }


                    /*
                     * إذا كان LID حاول حلو
                     */
                    if (isLidJid(jid)) {

                        const resolved =
                            await conn.getJid(jid)

                        if (
                            resolved &&
                            resolved !== jid
                        ) {
                            jid = resolved
                        }
                    }


                    let chat =
                        conn.chats?.[jid] || {}


                    let contact =
                        conn.contacts?.[jid] || {}


                    return (

                        (!withoutContact &&
                            contact.name) ||

                        contact.notify ||

                        chat.name ||

                        chat.notify ||

                        jid.split('@')[0]
                    )

                } catch {

                    return (
                        jid?.split('@')[0] ||
                        'Usuario'
                    )
                }
            }
        },


        /* =====================================================
         * LOAD MESSAGE
         * ===================================================== */

        loadMessage: {

            async value(
                jid,
                messageID
            ) {

                try {

                    if (
                        !jid ||
                        !messageID
                    ) {
                        return null
                    }


                    const chat =
                        conn.messages?.[jid]


                    if (!chat)
                        return null


                    if (chat[messageID]) {
                        return chat[messageID]
                    }


                    for (
                        const key in chat
                    ) {

                        if (
                            key === messageID ||
                            key.startsWith(messageID)
                        ) {
                            return chat[key]
                        }
                    }


                    for (
                        const msg of
                        Object.values(chat)
                    ) {

                        if (
                            msg?.key?.id ===
                            messageID
                        ) {
                            return msg
                        }
                    }


                    return null

                } catch (e) {

                    console.error(
                        'loadMessage error:',
                        e
                    )

                    return null
                }
            },

            enumerable: true
        },


        /* =====================================================
         * GROUP INVITE
         * ===================================================== */

        sendGroupV4Invite: {

            async value(
                jid,
                participant,
                inviteCode,
                inviteExpiration,
                groupName = 'unknown subject',
                caption = 'Invitation to join my WhatsApp group',
                jpegThumbnail,
                options = {}
            ) {

                const msg =
                    proto.Message.fromObject({

                        groupInviteMessage:
                            proto.GroupInviteMessage.fromObject({

                                inviteCode,

                                inviteExpiration:
                                    parseInt(inviteExpiration) ||
                                    +new Date(
                                        new Date +
                                        3 * 86400000
                                    ),

                                groupJid: jid,

                                groupName:
                                    groupName ||
                                    await conn.getName(jid),

                                jpegThumbnail:
                                    Buffer.isBuffer(
                                        jpegThumbnail
                                    )
                                        ? jpegThumbnail
                                        : null,

                                caption
                            })
                    })


                const message =
                    generateWAMessageFromContent(
                        participant,
                        msg,
                        options
                    )


                await conn.relayMessage(
                    participant,
                    message.message,
                    {
                        messageId:
                            message.key.id,

                        additionalAttributes:
                            {
                                ...options
                            }
                    }
                )


                return message
            }
        },


        /* =====================================================
         * PROCESS STUB
         * ===================================================== */

        processMessageStubType: {

            async value(m) {

                if (!m.messageStubType)
                    return


                const chat =
                    conn.decodeJid(
                        m.key.remoteJid ||
                        m.message
                            ?.senderKeyDistributionMessage
                            ?.groupId ||
                        ''
                    )


                if (
                    !chat ||
                    chat === 'status@broadcast'
                ) {
                    return
                }


                const emitGroupUpdate =
                    update => {

                        conn.ev.emit(
                            'groups.update',
                            [{
                                id: chat,
                                ...update
                            }]
                        )
                    }


                switch (
                    m.messageStubType
                ) {

                    case WAMessageStubType.REVOKE:

                    case WAMessageStubType
                        .GROUP_CHANGE_INVITE_LINK:

                        emitGroupUpdate({
                            revoke:
                                m.messageStubParameters[0]
                        })

                        break


                    case WAMessageStubType
                        .GROUP_CHANGE_ICON:

                        emitGroupUpdate({
                            icon:
                                m.messageStubParameters[0]
                        })

                        break


                    default:

                        console.log({
                            messageStubType:
                                m.messageStubType,

                            messageStubParameters:
                                m.messageStubParameters,

                            type:
                                WAMessageStubType[
                                    m.messageStubType
                                ]
                        })

                        break
                }


                const isGroup =
                    chat.endsWith('@g.us')


                if (!isGroup)
                    return


                let chats =
                    conn.chats[chat]


                if (!chats) {
                    chats =
                        conn.chats[chat] = {
                            id: chat
                        }
                }


                chats.isChats = true


                const metadata =
                    await conn
                        .groupMetadata(chat)
                        .catch(() => null)


                if (!metadata)
                    return


                chats.subject =
                    metadata.subject

                chats.metadata =
                    metadata


                /*
                 * حفظ LID -> PN من metadata
                 */
                for (
                    const participant of
                    metadata.participants || []
                ) {

                    const lid =
                        normalizeJid(
                            participant?.lid
                        )

                    const phone =
                        normalizeJid(
                            participant?.phoneNumber
                        )


                    if (
                        isLidJid(lid) &&
                        isPnJid(phone)
                    ) {

                        conn.isLid.set(
                            lid,
                            phone
                        )
                    }
                }
            }
        },


        /* =====================================================
         * INSERT GROUPS
         * ===================================================== */

        insertAllGroup: {

            async value() {

                const groups =
                    await conn
                        .groupFetchAllParticipating()
                        .catch(() => null) ||
                    {}


                for (
                    const group in groups
                ) {

                    const data =
                        groups[group]


                    conn.chats[group] = {

                        ...(conn.chats[group] || {}),

                        id: group,

                        subject:
                            data.subject,

                        isChats: true,

                        metadata:
                            data
                    }


                    /*
                     * Cache LID mappings
                     */
                    for (
                        const participant of
                        data.participants || []
                    ) {

                        const lid =
                            normalizeJid(
                                participant?.lid
                            )

                        const phone =
                            normalizeJid(
                                participant?.phoneNumber
                            )


                        if (
                            isLidJid(lid) &&
                            isPnJid(phone)
                        ) {

                            conn.isLid.set(
                                lid,
                                phone
                            )
                        }
                    }
                }


                return conn.chats
            }
        },


        /* =====================================================
         * PUSH MESSAGE
         * ===================================================== */

        pushMessage: {

            async value(m) {

                if (!m)
                    return

                if (!Array.isArray(m))
                    m = [m]


                for (
                    const message of m
                ) {

                    try {

                        if (!message)
                            continue


                        if (
                            message.messageStubType &&
                            message.messageStubType !==
                            WAMessageStubType.CIPHERTEXT
                        ) {

                            conn
                                .processMessageStubType(
                                    message
                                )
                                .catch(console.error)
                        }


                        const _mtype =
                            Object.keys(
                                message.message || {}
                            )


                        const mtype =
                            (
                                ![
                                    'senderKeyDistributionMessage',
                                    'messageContextInfo'
                                ].includes(_mtype[0]) &&
                                _mtype[0]
                            ) ||

                            (
                                _mtype.length >= 3 &&
                                _mtype[1] !==
                                'messageContextInfo' &&
                                _mtype[1]
                            ) ||

                            _mtype[
                                _mtype.length - 1
                            ]


                        const chat =
                            conn.decodeJid(
                                message.key.remoteJid ||
                                message.message
                                    ?.senderKeyDistributionMessage
                                    ?.groupId ||
                                ''
                            )


                        /*
                         * Quoted
                         */
                        if (
                            message.message
                                ?.[mtype]
                                ?.contextInfo
                                ?.quotedMessage
                        ) {

                            let context =
                                message.message[mtype]
                                    .contextInfo


                            let participant =
                                conn.decodeJid(
                                    context.participant
                                )


                            const remoteJid =
                                conn.decodeJid(
                                    context.remoteJid ||
                                    participant
                                )


                            let quoted =
                                context.quotedMessage


                            if (
                                remoteJid &&
                                remoteJid !==
                                'status@broadcast' &&
                                quoted
                            ) {

                                let qMtype =
                                    Object.keys(
                                        quoted
                                    )[0]


                                if (
                                    qMtype ===
                                    'conversation'
                                ) {

                                    quoted.extendedTextMessage =
                                        {
                                            text:
                                                quoted[
                                                    qMtype
                                                ]
                                        }

                                    delete quoted.conversation

                                    qMtype =
                                        'extendedTextMessage'
                                }


                                if (
                                    !quoted[qMtype]
                                        .contextInfo
                                ) {

                                    quoted[qMtype]
                                        .contextInfo = {}
                                }


                                quoted[qMtype]
                                    .contextInfo
                                    .mentionedJid =
                                    context
                                        .mentionedJid ||
                                    quoted[qMtype]
                                        .contextInfo
                                        .mentionedJid ||
                                    []


                                const isGroup =
                                    remoteJid.endsWith(
                                        '@g.us'
                                    )


                                if (
                                    isGroup &&
                                    !participant
                                ) {
                                    participant =
                                        remoteJid
                                }


                                const qM = {

                                    key: {

                                        remoteJid,

                                        fromMe:
                                            areJidsSameUser(
                                                conn.user.jid,
                                                remoteJid
                                            ),

                                        id:
                                            context.stanzaId,

                                        participant
                                    },

                                    message:
                                        JSON.parse(
                                            JSON.stringify(
                                                quoted
                                            )
                                        ),

                                    ...(isGroup
                                        ? {
                                            participant
                                        }
                                        : {})
                                }


                                let qChats =
                                    conn.chats[
                                        participant
                                    ]


                                if (!qChats) {

                                    qChats =
                                        conn.chats[
                                            participant
                                        ] = {

                                            id:
                                                participant,

                                            isChats:
                                                !isGroup
                                        }
                                }


                                if (!qChats.messages) {
                                    qChats.messages = {}
                                }


                                if (
                                    !qChats.messages[
                                        context.stanzaId
                                    ] &&
                                    !qM.key.fromMe
                                ) {

                                    qChats.messages[
                                        context.stanzaId
                                    ] = qM
                                }


                                let qChatsMessages


                                if (
                                    (
                                        qChatsMessages =
                                        Object.entries(
                                            qChats.messages
                                        )
                                    ).length > 40
                                ) {

                                    qChats.messages =
                                        Object.fromEntries(
                                            qChatsMessages.slice(
                                                30
                                            )
                                        )
                                }
                            }
                        }


                        if (
                            !chat ||
                            chat === 'status@broadcast'
                        ) {
                            continue
                        }


                        const isGroup =
                            chat.endsWith('@g.us')


                        let chats =
                            conn.chats[chat]


                        if (!chats) {

                            if (isGroup) {
                                await conn
                                    .insertAllGroup()
                                    .catch(
                                        console.error
                                    )
                            }


                            chats =
                                conn.chats[chat] = {

                                    id: chat,

                                    isChats: true,

                                    ...(conn.chats[chat] || {})
                                }
                        }


                        let metadata,
                            sender


                        if (isGroup) {

                            if (
                                !chats.subject ||
                                !chats.metadata
                            ) {

                                metadata =
                                    await conn
                                        .groupMetadata(chat)
                                        .catch(() => ({})) ||
                                    {}


                                if (!chats.subject) {
                                    chats.subject =
                                        metadata.subject ||
                                        ''
                                }


                                if (!chats.metadata) {
                                    chats.metadata =
                                        metadata
                                }


                                /*
                                 * Cache LID mappings
                                 */
                                for (
                                    const participant of
                                    metadata.participants ||
                                    []
                                ) {

                                    const lid =
                                        normalizeJid(
                                            participant?.lid
                                        )

                                    const phone =
                                        normalizeJid(
                                            participant?.phoneNumber
                                        )


                                    if (
                                        isLidJid(lid) &&
                                        isPnJid(phone)
                                    ) {

                                        conn.isLid.set(
                                            lid,
                                            phone
                                        )
                                    }
                                }
                            }


                            sender =
                                conn.decodeJid(
                                    message.key?.fromMe
                                        ? conn.user.id
                                        : message.participant ||
                                          message.key?.participant ||
                                          chat ||
                                          ''
                                )


                            /*
                             * إذا كان sender LID
                             * نحاول نحلّه
                             */
                            if (
                                isLidJid(sender)
                            ) {

                                const resolved =
                                    conn.isLid.get(
                                        sender
                                    )

                                if (
                                    resolved &&
                                    isPnJid(resolved)
                                ) {
                                    sender =
                                        resolved
                                }
                            }


                            if (sender !== chat) {

                                let senderChat =
                                    conn.chats[sender]


                                if (!senderChat) {

                                    senderChat =
                                        conn.chats[
                                            sender
                                        ] = {
                                            id: sender
                                        }
                                }


                                if (!senderChat.name) {

                                    senderChat.name =
                                        message.pushName ||
                                        senderChat.name ||
                                        ''
                                }
                            }

                        } else {

                            if (!chats.name) {

                                chats.name =
                                    message.pushName ||
                                    chats.name ||
                                    ''
                            }
                        }


                        if (
                            [
                                'senderKeyDistributionMessage',
                                'messageContextInfo'
                            ].includes(mtype)
                        ) {
                            continue
                        }


                        chats.isChats = true


                        if (!chats.messages) {
                            chats.messages = {}
                        }


                        const fromMe =
                            message.key.fromMe ||
                            areJidsSameUser(
                                sender || chat,
                                conn.user.id
                            )


                        if (
                            ![
                                'protocolMessage'
                            ].includes(mtype) &&

                            !fromMe &&

                            message.messageStubType !==
                            WAMessageStubType.CIPHERTEXT &&

                            message.message
                        ) {

                            delete message.message
                                .messageContextInfo

                            delete message.message
                                .senderKeyDistributionMessage


                            chats.messages[
                                message.key.id
                            ] =
                                JSON.parse(
                                    JSON.stringify(
                                        message,
                                        null,
                                        2
                                    )
                                )


                            let chatsMessages


                            if (
                                (
                                    chatsMessages =
                                    Object.entries(
                                        chats.messages
                                    )
                                ).length > 40
                            ) {

                                chats.messages =
                                    Object.fromEntries(
                                        chatsMessages.slice(
                                            30
                                        )
                                    )
                            }
                        }

                    } catch (e) {

                        console.error(e)
                    }
                }
            }
        },


        /* =====================================================
         * SERIALIZE
         * ===================================================== */

        serializeM: {

            value(m) {
                return smsg(conn, m)
            }
        },


        ...(typeof conn.chatRead !== 'function'
            ? {

                chatRead: {

                    value(
                        jid,
                        participant = conn.user.jid,
                        messageID
                    ) {

                        return conn.sendReadReceipt(
                            jid,
                            participant,
                            [messageID]
                        )
                    },

                    enumerable: true
                }
            }
            : {}),


        ...(typeof conn.setStatus !== 'function'
            ? {

                setStatus: {

                    value(status) {

                        return conn.query({

                            tag: 'iq',

                            attrs: {
                                to:
                                    's.whatsapp.net',

                                type: 'set',

                                xmlns:
                                    'status'
                            },

                            content: [

                                {
                                    tag: 'status',

                                    attrs: {},

                                    content:
                                        Buffer.from(
                                            status,
                                            'utf-8'
                                        )
                                }
                            ]
                        })
                    },

                    enumerable: true
                }
            }
            : {})
    })


    /*
     * Bot JID
     */
    if (sock.user?.id) {

        sock.user.jid =
            sock.decodeJid(
                sock.user.id
            )
    }


    store.bind(sock)

    return sock
}


/* =========================================================
 * SERIALIZE MESSAGE
 * ========================================================= */

export function smsg(
    conn,
    m,
    hasParent
) {

    if (!m)
        return m


    /**
     * @type {import('@whiskeysockets/baileys').proto.WebMessageInfo}
     */
    let M =
        proto.WebMessageInfo


    m =
        M.fromObject(m)


    m.conn =
        conn


    let protocolMessageKey


    if (m.message) {

        if (
            m.mtype === 'protocolMessage' &&
            m.msg.key
        ) {

            protocolMessageKey =
                m.msg.key


            if (
                protocolMessageKey ===
                'status@broadcast'
            ) {

                protocolMessageKey.remoteJid =
                    m.chat
            }


            if (
                !protocolMessageKey.participant ||
                protocolMessageKey.participant ===
                'status_me'
            ) {

                protocolMessageKey.participant =
                    m.sender
            }


            protocolMessageKey.fromMe =
                conn.decodeJid(
                    protocolMessageKey.participant
                ) ===
                conn.decodeJid(
                    conn.user.id
                )


            if (
                !protocolMessageKey.fromMe &&
                protocolMessageKey.remoteJid ===
                conn.decodeJid(
                    conn.user.id
                )
            ) {

                protocolMessageKey.remoteJid =
                    m.sender
            }
        }


        if (m.quoted) {

            if (!m.quoted.mediaMessage) {
                delete m.quoted.download
            }
        }
    }


    if (!m.mediaMessage) {
        delete m.download
    }


    try {

        if (
            protocolMessageKey &&
            m.mtype === 'protocolMessage'
        ) {

            conn.ev.emit(
                'message.delete',
                protocolMessageKey
            )
        }

    } catch (e) {

        console.error(e)
    }


    return m
}


/* =========================================================
 * SERIALIZE PROTOTYPE
 * ========================================================= */

export function serialize() {

    const MediaType = [
        'imageMessage',
        'videoMessage',
        'audioMessage',
        'stickerMessage',
        'documentMessage'
    ]


    return Object.defineProperties(
        proto.WebMessageInfo.prototype,
        {

            conn: {
                value: undefined,
                enumerable: false,
                writable: true
            },


            id: {

                get() {
                    return this.key?.id
                }
            },


            isBaileys: {

                get() {

                    return (
                        this.id?.length === 16 ||
                        (
                            this.id?.startsWith('3EB0') &&
                            this.id?.length === 12
                        ) ||
                        false
                    )
                }
            },


            /* =================================================
             * CHAT
             * ================================================= */

            chat: {

                get() {

                    const senderKeyDistributionMessage =
                        this.message
                            ?.senderKeyDistributionMessage
                            ?.groupId


                    return (
                        this.key?.remoteJid ||

                        (
                            senderKeyDistributionMessage &&
                            senderKeyDistributionMessage !==
                            'status@broadcast'
                                ? senderKeyDistributionMessage
                                : ''
                        )
                    ).decodeJid()
                }
            },


            isGroup: {

                get() {
                    return this.chat.endsWith('@g.us')
                },

                enumerable: true
            },


            /* =================================================
             * SENDER
             *
             * لا نحاول async هنا.
             * إذا كان LID موجود في cache يتم تحويله.
             * ================================================= */

            sender: {

                get() {

                    let jid =
                        this.key?.fromMe

                            ? this.conn?.user?.id

                            : this.participant ||
                              this.key?.participant ||
                              this.chat ||
                              ''


                    if (!jid)
                        return jid


                    jid =
                        this.conn?.decodeJid(jid)


                    /*
                     * LID -> PN من cache
                     */
                    if (
                        isLidJid(jid)
                    ) {

                        const resolved =
                            this.conn?.isLid?.get(
                                jid
                            )


                        if (
                            resolved &&
                            isPnJid(resolved)
                        ) {

                            return resolved
                        }
                    }


                    return jid
                },

                enumerable: true
            },


            fromMe: {

                get() {

                    return (
                        this.key?.fromMe ||

                        areJidsSameUser(
                            this.conn?.user.id,
                            this.sender
                        ) ||

                        false
                    )
                }
            },


            mtype: {

                get() {

                    if (!this.message)
                        return ''


                    const type =
                        Object.keys(
                            this.message
                        )


                    return (

                        (
                            ![
                                'senderKeyDistributionMessage',
                                'messageContextInfo'
                            ].includes(type[0]) &&
                            type[0]
                        ) ||

                        (
                            type.length >= 3 &&
                            type[1] !==
                            'messageContextInfo' &&
                            type[1]
                        ) ||

                        type[type.length - 1]
                    )
                },

                enumerable: true
            },


            msg: {

                get() {

                    if (!this.message)
                        return null

                    return this.message[
                        this.mtype
                    ]
                }
            },


            mediaMessage: {

                get() {

                    if (!this.message)
                        return null


                    const Message =
                        (
                            this.msg?.url ||
                            this.msg?.directPath
                        )

                            ? {
                                ...this.message
                            }

                            : extractMessageContent(
                                this.message
                            )


                    if (!Message)
                        return null


                    const mtype =
                        Object.keys(
                            Message
                        )[0]


                    return MediaType.includes(
                        mtype
                    )
                        ? Message
                        : null
                },

                enumerable: true
            },


            mediaType: {

                get() {

                    let message


                    if (
                        !(message =
                            this.mediaMessage)
                    ) {
                        return null
                    }


                    return Object.keys(
                        message
                    )[0]
                },

                enumerable: true
            },


            /* =================================================
             * QUOTED
             * ================================================= */

            quoted: {

                get() {

                    const self =
                        this

                    const msg =
                        self.msg


                    const contextInfo =
                        msg?.contextInfo


                    const quoted =
                        contextInfo?.quotedMessage


                    if (
                        !msg ||
                        !contextInfo ||
                        !quoted
                    ) {
                        return null
                    }


                    const type =
                        Object.keys(
                            quoted
                        )[0]


                    let q =
                        quoted[type]


                    const text =
                        typeof q === 'string'
                            ? q
                            : q.text


                    return Object.defineProperties(

                        JSON.parse(
                            JSON.stringify(
                                typeof q === 'string'
                                    ? { text: q }
                                    : q
                            )
                        ),

                        {

                            mtype: {

                                get() {
                                    return type
                                },

                                enumerable: true
                            },


                            mediaMessage: {

                                get() {

                                    const Message =
                                        (
                                            q.url ||
                                            q.directPath
                                        )

                                            ? {
                                                ...quoted
                                            }

                                            : extractMessageContent(
                                                quoted
                                            )


                                    if (!Message)
                                        return null


                                    const mtype =
                                        Object.keys(
                                            Message
                                        )[0]


                                    return MediaType.includes(
                                        mtype
                                    )
                                        ? Message
                                        : null
                                },

                                enumerable: true
                            },


                            mediaType: {

                                get() {

                                    let message


                                    if (
                                        !(message =
                                            this.mediaMessage)
                                    ) {
                                        return null
                                    }


                                    return Object.keys(
                                        message
                                    )[0]
                                },

                                enumerable: true
                            },


                            id: {

                                get() {
                                    return contextInfo.stanzaId
                                },

                                enumerable: true
                            },


                            chat: {

                                get() {

                                    return (
                                        contextInfo.remoteJid ||
                                        self.chat
                                    )
                                },

                                enumerable: true
                            },


                            isBaileys: {

                                get() {

                                    return (
                                        this.id?.length === 16 ||

                                        (
                                            this.id?.startsWith(
                                                '3EB0'
                                            ) &&
                                            this.id.length === 12
                                        ) ||

                                        false
                                    )
                                },

                                enumerable: true
                            },


                            /* =================================
                             * QUOTED SENDER - LID FIX
                             * ================================= */

                            sender: {

                                get() {

                                    let sender =
                                        contextInfo.participant ||
                                        this.chat ||
                                        ''


                                    sender =
                                        self.conn?.decodeJid(
                                            sender
                                        )


                                    /*
                                     * LID cache
                                     */
                                    if (
                                        isLidJid(sender)
                                    ) {

                                        const resolved =
                                            self.conn
                                                ?.isLid
                                                ?.get(sender)


                                        if (
                                            resolved &&
                                            isPnJid(resolved)
                                        ) {

                                            return resolved
                                        }
                                    }


                                    return sender
                                },

                                enumerable: true
                            },


                            fromMe: {

                                get() {

                                    return areJidsSameUser(
                                        this.sender,
                                        self.conn?.user.jid
                                    )
                                },

                                enumerable: true
                            },


                            text: {

                                get() {

                                    return (
                                        text ||
                                        this.caption ||
                                        this.contentText ||
                                        this.selectedDisplayText ||
                                        ''
                                    )
                                },

                                enumerable: true
                            },


                            mentionedJid: {

                                get() {

                                    return (
                                        q.contextInfo
                                            ?.mentionedJid ||

                                        self
                                            .getQuotedObj()
                                            ?.mentionedJid ||

                                        []
                                    )
                                },

                                enumerable: true
                            },


                            name: {

                                get() {

                                    const sender =
                                        this.sender


                                    return sender
                                        ? self.conn?.getName(
                                            sender
                                        )
                                        : null
                                },

                                enumerable: true
                            },


                            vM: {

                                get() {

                                    return proto.WebMessageInfo
                                        .fromObject({

                                            key: {

                                                fromMe:
                                                    this.fromMe,

                                                remoteJid:
                                                    this.chat,

                                                id:
                                                    this.id
                                            },

                                            message:
                                                quoted,

                                            ...(self.isGroup
                                                ? {
                                                    participant:
                                                        this.sender
                                                }
                                                : {})
                                        })
                                }
                            },


                            fakeObj: {

                                get() {
                                    return this.vM
                                }
                            },


                            download: {

                                value(
                                    saveToFile = false
                                ) {

                                    const mtype =
                                        this.mediaType


                                    return self.conn
                                        ?.downloadM(
                                            this.mediaMessage[
                                                mtype
                                            ],

                                            mtype.replace(
                                                /message/i,
                                                ''
                                            ),

                                            saveToFile
                                        )
                                },

                                enumerable: true,

                                configurable: true
                            },


                            reply: {

                                value(
                                    text,
                                    chatId,
                                    options = {}
                                ) {

                                    return self.conn
                                        ?.reply(
                                            chatId ||
                                            this.chat,

                                            text,

                                            this.vM,

                                            options
                                        )
                                },

                                enumerable: true
                            },


                            copy: {

                                value() {

                                    const M =
                                        proto.WebMessageInfo


                                    return smsg(
                                        self.conn,

                                        M.fromObject(
                                            M.toObject(
                                                this.vM
                                            )
                                        )
                                    )
                                },

                                enumerable: true
                            },


                            forward: {

                                value(
                                    jid,
                                    force = false,
                                    options = {}
                                ) {

                                    return self.conn
                                        ?.sendMessage(
                                            jid,
                                            {
                                                forward:
                                                    this.vM,

                                                force,

                                                ...options
                                            },

                                            {
                                                ...options
                                            }
                                        )
                                },

                                enumerable: true
                            },


                            copyNForward: {

                                value(
                                    jid,
                                    forceForward = false,
                                    options = {}
                                ) {

                                    return self.conn
                                        ?.copyNForward(
                                            jid,
                                            this.vM,
                                            forceForward,
                                            options
                                        )
                                },

                                enumerable: true
                            },


                            cMod: {

                                value(
                                    jid,
                                    text = '',
                                    sender = this.sender,
                                    options = {}
                                ) {

                                    return self.conn
                                        ?.cMod(
                                            jid,
                                            this.vM,
                                            text,
                                            sender,
                                            options
                                        )
                                },

                                enumerable: true
                            },


                            delete: {

                                value() {

                                    return self.conn
                                        ?.sendMessage(
                                            this.chat,
                                            {
                                                delete:
                                                    this.vM.key
                                            }
                                        )
                                },

                                enumerable: true
                            },


                            react: {

                                value(text) {

                                    return self.conn
                                        ?.sendMessage(
                                            this.chat,
                                            {
                                                react: {

                                                    text,

                                                    key:
                                                        this.vM.key
                                                }
                                            }
                                        )
                                },

                                enumerable: true
                            }
                        }
                    )
                },

                enumerable: true
            },


            /* =================================================
             * TEXT
             * ================================================= */

            _text: {
                value: null,
                writable: true
            },


            text: {

                get() {

                    const msg =
                        this.msg


                    const text =
                        (
                            typeof msg === 'string'
                                ? msg
                                : msg?.text
                        ) ||

                        msg?.caption ||

                        msg?.contentText ||

                        ''


                    return typeof this._text === 'string'
                        ? this._text
                        : '' ||

                        (
                            typeof text === 'string'
                                ? text
                                : (
                                    text?.selectedDisplayText ||
                                    text?.hydratedTemplate
                                        ?.hydratedContentText ||
                                    text
                                )
                        ) ||

                        ''
                },

                set(str) {
                    return this._text = str
                },

                enumerable: true
            },


            mentionedJid: {

                get() {

                    return (
                        this.msg
                            ?.contextInfo
                            ?.mentionedJid
                            ?.length &&

                        this.msg
                            .contextInfo
                            .mentionedJid
                    ) || []
                },

                enumerable: true
            },


            name: {

                get() {

                    return (
                        this.pushName ||
                        this.sender?.split('@')[0] ||
                        'Usuario'
                    )
                },

                enumerable: true
            },


            download: {

                value(
                    saveToFile = false
                ) {

                    const mtype =
                        this.mediaType


                    return this.conn
                        ?.downloadM(
                            this.mediaMessage[mtype],
                            mtype.replace(
                                /message/i,
                                ''
                            ),
                            saveToFile
                        )
                },

                enumerable: true,

                configurable: true
            },


            /* =================================================
             * MESSAGE REPLY
             * ================================================= */

            reply: {

                async value(
                    text,
                    chatId,
                    options = {}
                ) {

                    const jid =
                        chatId || this.chat


                    if (!jid)
                        return


                    const isGroup =
                        jid.endsWith('@g.us')


                    const finalQuoted =
                        isGroup
                            ? this
                            : null


                    return await this.conn
                        .sendMessage(

                            jid,

                            {
                                text,
                                ...options
                            },

                            {
                                quoted:
                                    finalQuoted
                            }
                        )
                }
            },


            copy: {

                value() {

                    const M =
                        proto.WebMessageInfo


                    return smsg(
                        this.conn,

                        M.fromObject(
                            M.toObject(this)
                        )
                    )
                },

                enumerable: true
            },


            forward: {

                value(
                    jid,
                    force = false,
                    options = {}
                ) {

                    return this.conn
                        ?.sendMessage(

                            jid,

                            {
                                forward: this,
                                force,
                                ...options
                            },

                            {
                                ...options
                            }
                        )
                },

                enumerable: true
            },


            copyNForward: {

                value(
                    jid,
                    forceForward = false,
                    options = {}
                ) {

                    return this.conn
                        ?.copyNForward(
                            jid,
                            this,
                            forceForward,
                            options
                        )
                },

                enumerable: true
            },


            cMod: {

                value(
                    jid,
                    text = '',
                    sender = this.sender,
                    options = {}
                ) {

                    return this.conn
                        ?.cMod(
                            jid,
                            this,
                            text,
                            sender,
                            options
                        )
                },

                enumerable: true
            },


            getQuotedObj: {

                value() {

                    if (!this.quoted?.id)
                        return null


                    const q =
                        proto.WebMessageInfo
                            .fromObject(

                                this.conn
                                    ?.loadMessage(
                                        this.chat,
                                        this.quoted.id
                                    ) ||

                                this.quoted.vM
                            )


                    return smsg(
                        this.conn,
                        q
                    )
                },

                enumerable: true
            },


            getQuotedMessage: {

                get() {
                    return this.getQuotedObj
                }
            },


            delete: {

                value() {

                    return this.conn
                        ?.sendMessage(
                            this.chat,
                            {
                                delete:
                                    this.key
                            }
                        )
                },

                enumerable: true
            },


            react: {

                value(text) {

                    return this.conn
                        ?.sendMessage(
                            this.chat,
                            {
                                react: {

                                    text,

                                    key:
                                        this.key
                                }
                            }
                        )
                },

                enumerable: true
            }
        }
    )
}


/* =========================================================
 * LOGIC
 * ========================================================= */

export function logic(
    check,
    inp,
    out
) {

    if (
        inp.length !==
        out.length
    ) {
        throw new Error(
            'Input and Output must have same length'
        )
    }


    for (let i in inp) {

        if (
            util.isDeepStrictEqual(
                check,
                inp[i]
            )
        ) {
            return out[i]
        }
    }


    return null
}


/* =========================================================
 * PROTOTYPES
 * ========================================================= */

export function protoType() {

    Buffer.prototype.toArrayBuffer =
        function toArrayBufferV2() {

            const ab =
                new ArrayBuffer(
                    this.length
                )


            const view =
                new Uint8Array(ab)


            for (
                let i = 0;
                i < this.length;
                ++i
            ) {

                view[i] =
                    this[i]
            }


            return ab
        }


    Buffer.prototype.toArrayBufferV2 =
        function toArrayBuffer() {

            return this.buffer.slice(
                this.byteOffset,
                this.byteOffset +
                this.byteLength
            )
        }


    ArrayBuffer.prototype.toBuffer =
        function toBuffer() {

            return Buffer.from(
                new Uint8Array(this)
            )
        }


    Uint8Array.prototype.getFileType =
        ArrayBuffer.prototype.getFileType =
        Buffer.prototype.getFileType =

        async function getFileType() {

            return await fileTypeFromBuffer(
                this
            )
        }


    String.prototype.isNumber =
        Number.prototype.isNumber =
        isNumber


    String.prototype.capitalize =
        function capitalize() {

            return (
                this.charAt(0).toUpperCase() +
                this.slice(1, this.length)
            )
        }


    String.prototype.capitalizeV2 =
        function capitalizeV2() {

            const str =
                this.split(' ')


            return str
                .map(v => v.capitalize())
                .join(' ')
        }


    /*
     * مهم:
     * decodeJid لا يحول LID.
     * فقط ينظف device JID.
     */
    String.prototype.decodeJid =
        function decodeJid() {

            return normalizeJid(this)
        }


    Number.prototype.toTimeString =
        function toTimeString() {

            const seconds =
                Math.floor(
                    (this / 1000) % 60
                )

            const minutes =
                Math.floor(
                    (this / (60 * 1000)) % 60
                )

            const hours =
                Math.floor(
                    (this / (60 * 60 * 1000)) % 24
                )

            const days =
                Math.floor(
                    this /
                    (24 * 60 * 60 * 1000)
                )


            return (

                (days
                    ? `${days} day(s) `
                    : '') +

                (hours
                    ? `${hours} hour(s) `
                    : '') +

                (minutes
                    ? `${minutes} minute(s) `
                    : '') +

                (seconds
                    ? `${seconds} second(s)`
                    : '')
            ).trim()
        }


    Number.prototype.getRandom =
        String.prototype.getRandom =
        Array.prototype.getRandom =
        getRandom
}


/* =========================================================
 * HELPERS
 * ========================================================= */

function isNumber() {

    const int =
        parseInt(this)


    return (
        typeof int === 'number' &&
        !isNaN(int)
    )
}


function getRandom() {

    if (
        Array.isArray(this) ||
        this instanceof String
    ) {

        return this[
            Math.floor(
                Math.random() *
                this.length
            )
        ]
    }


    return Math.floor(
        Math.random() *
        this
    )
}


/**
 * Nullish
 */
function nullish(args) {

    return !(
        args !== null &&
        args !== undefined
    )
}