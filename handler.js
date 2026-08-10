import { smsg } from './lib/simple.js'
import { format } from 'util'
import { fileURLToPath } from 'url'
import path, { join } from 'path'
import { unwatchFile, watchFile } from 'fs'
import chalk from 'chalk'

/**
 * @type {import('@whiskeysockets/baileys')}
 */

const { proto } = (await import('@whiskeysockets/baileys')).default

const isNumber = x =>
    typeof x === 'number' && !isNaN(x)

const delay = ms =>
    isNumber(ms) &&
    new Promise(resolve =>
        setTimeout(resolve, ms)
    )

export async function handler(chatUpdate) {

    let settings = {}

    this.msgqueque =
        this.msgqueque || []

    if (!chatUpdate)
        return

    if (!chatUpdate.messages?.length)
        return

    let rawMessage =
        chatUpdate.messages[
            chatUpdate.messages.length - 1
        ]

    if (!rawMessage)
        return

    if (global.db.data == null)
        await global.loadDatabase()

    global.db.data ||= {}
    global.db.data.users ||= {}
    global.db.data.chats ||= {}
    global.db.data.stats ||= {}
    global.db.data.settings ||= {}
    global.db.data.statsMsg ||= {}

    let m = rawMessage

    try {

        /*
         * مهم:
         * لا نبدلوش m.chat ولا m.sender بالقوة.
         *
         * smsg هو المسؤول على serialization.
         * هذا كيخلي:
         *
         * @s.whatsapp.net
         * @lid
         * @g.us
         *
         * يخدمو كيف ما جاو من Baileys.
         */

        m =
            smsg(
                this,
                rawMessage
            ) || rawMessage

        if (!m)
            return

        /*
         * Ignore messages from the bot
         */
        if (m.key?.fromMe)
            return

        /*
         * Ignore protocol messages
         */
        if (
            m.message?.protocolMessage ||
            m.message?.reactionMessage
        ) {
            return
        }

        /*
         * Basic values
         */

        m.exp = 0
        m.coin = 0
        m.diamond = false

        /*
         * Make sure text always exists.
         */

        if (
            typeof m.text !== 'string'
        ) {
            m.text = ''
        }

        /*
         * =====================================
         * DATABASE USER
         * =====================================
         */

        const senderJid =
            m.sender ||
            m.key?.participant ||
            m.key?.remoteJid

        const chatJid =
            m.chat ||
            m.key?.remoteJid

        if (!senderJid)
            return

        if (!global.db.data.users[senderJid]) {

            global.db.data.users[senderJid] = {

                exp: 0,
                coin: 0,
                diamond: 20,
                bank: 0,

                registered: false,
                name: m.name,

                age: -1,
                regTime: -1,

                afk: -1,
                afkReason: '',

                banned: false,

                level: 0,
                role: 'مبتدئ',

                autolevelup: false,

                prem: false
            }
        }

        const userData =
            global.db.data.users[senderJid]

        /*
         * Defaults
         */

        const userDefaults = {

            exp: 0,
            coin: 0,
            diamond: 20,
            bank: 0,

            registered: false,
            name: m.name,

            age: -1,
            regTime: -1,

            afk: -1,
            afkReason: '',

            banned: false,

            level: 0,
            role: 'مبتدئ',

            autolevelup: false,

            prem: false
        }

        for (
            const key in userDefaults
        ) {

            if (
                userData[key] === undefined ||
                userData[key] === null
            ) {

                userData[key] =
                    userDefaults[key]
            }
        }

        /*
         * =====================================
         * DATABASE CHAT
         * =====================================
         *
         * نفس الشيء للخاص والمجموعة.
         */

        if (
            chatJid &&
            !global.db.data.chats[chatJid]
        ) {

            global.db.data.chats[chatJid] = {}
        }

        const chat =
            chatJid
                ? (
                    global.db.data.chats[chatJid] || {}
                )
                : {}

        const chatDefaults = {

            isBanned: false,

            welcome: false,
            detect: false,

            sWelcome: '',
            sBye: '',

            sPromote: '',
            sDemote: '',

            antiLink: false,
            nsfw: false,

            rules: '',
            antiBotClone: false
        }

        if (chatJid) {

            for (
                const key in chatDefaults
            ) {

                if (
                    chat[key] === undefined ||
                    chat[key] === null
                ) {

                    chat[key] =
                        chatDefaults[key]
                }
            }
        }

        /*
         * =====================================
         * OWNER / MOD / PREMIUM
         * =====================================
         *
         * لا نحولو sender إلى رقم جديد.
         *
         * هذا مهم جداً مع @lid.
         */

        const normalizeOwner =
            value => {

                if (!value)
                    return []

                const raw =
                    String(value)

                const result = []

                /*
                 * Keep original JID
                 */

                result.push(raw)

                /*
                 * If LID keep it as LID.
                 */

                if (
                    raw.includes('@lid')
                ) {

                    result.push(
                        raw.split(':')[0] +
                        '@lid'
                    )

                    return [
                        ...new Set(result)
                    ]
                }

                /*
                 * Normal WhatsApp JID
                 */

                const number =
                    raw
                        .split(':')[0]
                        .replace(
                            /[^0-9]/g,
                            ''
                        )

                if (number) {

                    result.push(
                        number +
                        '@s.whatsapp.net'
                    )
                }

                return [
                    ...new Set(result)
                ]
            }

        const sameJid =
            (a, b) => {

                if (!a || !b)
                    return false

                if (a === b)
                    return true

                const aa =
                    String(a)

                const bb =
                    String(b)

                if (
                    aa === bb
                ) {
                    return true
                }

                /*
                 * Try Baileys decodeJid
                 */

                try {

                    if (
                        typeof this.decodeJid ===
                        'function'
                    ) {

                        if (
                            this.decodeJid(aa) ===
                            this.decodeJid(bb)
                        ) {

                            return true
                        }
                    }

                } catch {}

                return false
            }

        const ownerList = []

        /*
         * Bot account
         */

        for (
            const id of [
                this.user?.id,
                this.user?.lid,
                this.user?.jid
            ]
        ) {

            if (!id)
                continue

            ownerList.push(
                ...normalizeOwner(id)
            )
        }

        /*
         * global.owner
         */

        for (
            const owner of
            Array.isArray(global.owner)
                ? global.owner
                : []
        ) {

            const value =
                Array.isArray(owner)
                    ? owner[0]
                    : owner

            ownerList.push(
                ...normalizeOwner(value)
            )
        }

        const isROwner =
            ownerList.some(
                owner =>
                    sameJid(
                        owner,
                        senderJid
                    )
            ) ||
            m.fromMe === true

        const isOwner =
            isROwner ||
            m.fromMe === true

        /*
         * Mods
         */

        const isMods =
            isOwner ||
            (
                Array.isArray(global.mods)
                    ? global.mods
                    : []
            ).some(
                mod =>
                    normalizeOwner(mod)
                        .some(
                            jid =>
                                sameJid(
                                    jid,
                                    senderJid
                                )
                        )
            )

        /*
         * Premium
         */

        const isPrems =
            isOwner ||
            (
                Array.isArray(global.prems)
                    ? global.prems
                    : []
            ).some(
                prem =>
                    normalizeOwner(prem)
                        .some(
                            jid =>
                                sameJid(
                                    jid,
                                    senderJid
                                )
                        )
            ) ||
            userData.prem === true

        /*
         * Ban
         */

        if (
            userData.banned &&
            !isOwner
        ) {
            return
        }

        /*
         * =====================================
         * GROUP METADATA
         * =====================================
         *
         * مهم:
         * ما نديروش groupMetadata في الخاص.
         */

        const isGroup =
            Boolean(
                m.isGroup
            )

        let groupMetadata = {}
        let participants = []

        if (isGroup) {

            try {

                groupMetadata =
                    await this
                        .groupMetadata(
                            chatJid
                        )
                        .catch(
                            () => null
                        ) || {}

                participants =
                    Array.isArray(
                        groupMetadata.participants
                    )
                        ? groupMetadata.participants
                        : []

            } catch {

                groupMetadata = {}
                participants = []
            }
        }

        /*
         * =====================================
         * GROUP USER / BOT
         * =====================================
         */

        let groupUser = {}
        let bot = {}

        if (isGroup) {

            const senderDecoded =
                typeof this.decodeJid ===
                'function'
                    ? this.decodeJid(senderJid)
                    : senderJid

            groupUser =
                participants.find(
                    participant => {

                        const ids = [
                            participant?.id,
                            participant?.jid,
                            participant?.phoneNumber
                        ].filter(Boolean)

                        return ids.some(
                            id => {

                                try {

                                    const decoded =
                                        typeof this.decodeJid ===
                                        'function'
                                            ? this.decodeJid(id)
                                            : id

                                    return (
                                        decoded ===
                                        senderDecoded
                                    )

                                } catch {

                                    return (
                                        id ===
                                        senderJid
                                    )
                                }
                            }
                        )
                    }
                ) || {}

            const botIds = [
                this.user?.id,
                this.user?.lid,
                this.user?.jid
            ].filter(Boolean)

            bot =
                participants.find(
                    participant => {

                        const ids = [
                            participant?.id,
                            participant?.jid,
                            participant?.phoneNumber
                        ].filter(Boolean)

                        return ids.some(
                            id =>
                                botIds.some(
                                    botId =>
                                        sameJid(
                                            id,
                                            botId
                                        )
                                )
                        )
                    }
                ) || {}
        }

        /*
         * =====================================
         * ADMIN
         * =====================================
         */

        const isRAdmin =
            isGroup &&
            (
                groupUser?.admin ===
                'superadmin' ||
                sameJid(
                    groupMetadata?.owner,
                    senderJid
                )
            )

        const isAdmin =
            isGroup &&
            (
                Boolean(
                    groupUser?.admin
                ) ||
                sameJid(
                    groupMetadata?.owner,
                    senderJid
                )
            )

        const isBotAdmin =
            isGroup &&
            Boolean(
                bot?.admin
            )

        /*
         * =====================================
         * BASIC EXP
         * =====================================
         */

        if (m.isBaileys)
            return

        m.exp +=
            Math.ceil(
                Math.random() * 10
            )

        /*
         * =====================================
         * PLUGINS DIRECTORY
         * =====================================
         */

        const ___dirname =
            path.join(
                path.dirname(
                    fileURLToPath(
                        import.meta.url
                    )
                ),
                './plugins'
            )

        /*
         * =====================================
         * PLUGIN LOOP
         * =====================================
         */

        for (
            const name in global.plugins
        ) {

            const plugin =
                global.plugins[name]

            if (!plugin)
                continue

            if (plugin.disabled)
                continue

            const __filename =
                join(
                    ___dirname,
                    name
                )

            /*
             * =================================
             * ALL
             * =================================
             */

            if (
                typeof plugin.all ===
                'function'
            ) {

                try {

                    await plugin.all.call(
                        this,
                        m,
                        {
                            chatUpdate,
                            __dirname:
                                ___dirname,
                            __filename
                        }
                    )

                } catch (e) {

                    console.error(
                        `[Plugin All Error] ${name}`,
                        e
                    )
                }
            }

            /*
             * =================================
             * PREFIX
             * =================================
             *
             * نفس الفكرة ديال handler الآخر:
             * prefix يتفحص بشكل صحيح.
             */

            const str2Regex =
                str =>
                    String(str)
                        .replace(
                            /[|\\{}()[\]^$+*?.]/g,
                            '\\$&'
                        )

            const prefix =
                plugin.customPrefix ||
                this.prefix ||
                global.prefix

            let match = null

            if (
                prefix instanceof RegExp
            ) {

                prefix.lastIndex = 0

                const result =
                    prefix.exec(
                        m.text
                    )

                if (result) {

                    match = [
                        result,
                        prefix
                    ]
                }

            } else if (
                Array.isArray(prefix)
            ) {

                for (
                    const p of prefix
                ) {

                    const re =
                        p instanceof RegExp
                            ? p
                            : new RegExp(
                                str2Regex(p)
                            )

                    re.lastIndex = 0

                    const result =
                        re.exec(
                            m.text
                        )

                    if (result) {

                        match = [
                            result,
                            re
                        ]

                        break
                    }
                }

            } else if (
                typeof prefix ===
                'string'
            ) {

                const re =
                    new RegExp(
                        str2Regex(prefix)
                    )

                const result =
                    re.exec(
                        m.text
                    )

                if (result) {

                    match = [
                        result,
                        re
                    ]
                }
            }

            /*
             * =================================
             * BEFORE
             * =================================
             */

            if (
                typeof plugin.before ===
                'function'
            ) {

                try {

                    if (
                        await plugin.before.call(
                            this,
                            m,
                            {

                                match,

                                conn: this,

                                participants,

                                groupMetadata,

                                user:
                                    groupUser,

                                bot,

                                isROwner,
                                isOwner,

                                isRAdmin,
                                isAdmin,
                                isBotAdmin,

                                isPrems,

                                chatUpdate,

                                __dirname:
                                    ___dirname,

                                __filename

                            }
                        )
                    ) {

                        continue
                    }

                } catch (e) {

                    console.error(
                        `[Plugin Before Error] ${name}`,
                        e
                    )

                    continue
                }
            }

            /*
             * =================================
             * ONLY FUNCTIONS
             * =================================
             */

            if (
                typeof plugin !==
                'function'
            ) {
                continue
            }

            /*
             * No prefix = no command
             */

            if (!match)
                continue

            /*
             * =================================
             * COMMAND
             * =================================
             */

            const usedPrefix =
                match[0]?.[0] || ''

            m.prefix =
                usedPrefix

            const noPrefix =
                m.text
                    .slice(
                        usedPrefix.length
                    )
                    .trim()

            let [
                command,
                ...args
            ] =
                noPrefix
                    .split(/\s+/)
                    .filter(Boolean)

            command =
                (
                    command || ''
                ).toLowerCase()

            args =
                args || []

            const _args =
                noPrefix
                    .split(/\s+/)
                    .slice(1)

            const text =
                _args.join(' ')

            /*
             * =================================
             * COMMAND MATCH
             * =================================
             */

            const pluginCommand =
                plugin.command

            let isAccept = false

            if (
                pluginCommand instanceof
                RegExp
            ) {

                pluginCommand.lastIndex = 0

                isAccept =
                    pluginCommand.test(
                        command
                    )

            } else if (
                Array.isArray(
                    pluginCommand
                )
            ) {

                isAccept =
                    pluginCommand.some(
                        cmd => {

                            if (
                                cmd instanceof
                                RegExp
                            ) {

                                cmd.lastIndex = 0

                                return cmd.test(
                                    command
                                )
                            }

                            return (
                                cmd ===
                                command
                            )
                        }
                    )

            } else if (
                typeof pluginCommand ===
                'string'
            ) {

                isAccept =
                    pluginCommand ===
                    command
            }

            if (!isAccept)
                continue

            /*
             * =================================
             * COMMAND INFO
             * =================================
             */

            m.plugin =
                name

            m.command =
                command

            m.isCommand =
                true

            /*
             * =================================
             * CHAT GUARDS
             * =================================
             *
             * هنا الفرق:
             *
             * ما كاين حتى guard عام للخاص.
             *
             * Group فقط إذا plugin.group
             * Private فقط إذا plugin.private
             */

            if (
                chat?.isBanned &&
                !isOwner
            ) {
                continue
            }

            if (
                plugin.group &&
                !isGroup
            ) {

                if (
                    typeof plugin.fail ===
                    'function'
                ) {

                    await plugin.fail(
                        'group',
                        m,
                        this
                    )

                } else if (
                    global.dfail
                ) {

                    await global.dfail(
                        'group',
                        m,
                        this
                    )
                }

                continue
            }

            if (
                plugin.private &&
                isGroup
            ) {

                if (
                    typeof plugin.fail ===
                    'function'
                ) {

                    await plugin.fail(
                        'private',
                        m,
                        this
                    )

                } else if (
                    global.dfail
                ) {

                    await global.dfail(
                        'private',
                        m,
                        this
                    )
                }

                continue
            }

            /*
             * =================================
             * PERMISSIONS
             * =================================
             */

            const fail =
                plugin.fail ||
                global.dfail

            if (
                plugin.rowner &&
                !isROwner
            ) {

                await fail(
                    'rowner',
                    m,
                    this
                )

                continue
            }

            if (
                plugin.owner &&
                !isOwner
            ) {

                await fail(
                    'owner',
                    m,
                    this
                )

                continue
            }

            if (
                plugin.mods &&
                !isMods
            ) {

                await fail(
                    'mods',
                    m,
                    this
                )

                continue
            }

            if (
                plugin.premium &&
                !isPrems
            ) {

                await fail(
                    'premium',
                    m,
                    this
                )

                continue
            }

            if (
                plugin.admin &&
                !isAdmin
            ) {

                await fail(
                    'admin',
                    m,
                    this
                )

                continue
            }

            if (
                plugin.botAdmin &&
                !isBotAdmin
            ) {

                await fail(
                    'botAdmin',
                    m,
                    this
                )

                continue
            }

            if (
                plugin.register === true &&
                userData.registered === false
            ) {

                await fail(
                    'unreg',
                    m,
                    this
                )

                continue
            }

            /*
             * =================================
             * LEVEL
             * =================================
             */

            if (
                plugin.level &&
                plugin.level >
                userData.level
            ) {

                await this.reply(
                    m.chat,
                    `✳️ هذا الأمر يتطلب المستوى ${plugin.level} لاستخدامه.\n` +
                    `مستواك الحالي هو: ${userData.level}`,
                    m
                )

                continue
            }

            /*
             * =================================
             * DIAMOND
             * =================================
             */

            if (
                !isPrems &&
                plugin.diamond &&
                userData.diamond <
                plugin.diamond * 1
            ) {

                await this.reply(
                    m.chat,
                    `✳️ لقد نفذت مجوهراتك 💎\n\n` +
                    `استخدم الأمر التالي لشراء المزيد:\n\n` +
                    `*${usedPrefix}buy*`,
                    m
                )

                continue
            }

            /*
             * =================================
             * EXP
             * =================================
             */

            const xp =
                'exp' in plugin
                    ? parseInt(
                        plugin.exp
                    )
                    : 17

            if (
                !isNaN(xp)
            ) {

                m.exp += xp
            }

            /*
             * =================================
             * EXTRA
             * =================================
             */

            const extra = {

                match,

                usedPrefix,

                noPrefix,

                _args,

                args,

                command,

                text,

                conn: this,

                participants,

                groupMetadata,

                user:
                    groupUser,

                bot,

                isROwner,
                isOwner,

                isRAdmin,
                isAdmin,
                isBotAdmin,

                isPrems,

                chatUpdate,

                __dirname:
                    ___dirname,

                __filename
            }

            /*
             * =================================
             * EXECUTE PLUGIN
             * =================================
             */

            try {

                await plugin.call(
                    this,
                    m,
                    extra
                )

                if (
                    !isPrems
                ) {

                    m.diamond =
                        m.diamond ||
                        plugin.diamond ||
                        false
                }

            } catch (e) {

                m.error =
                    e

                console.error(
                    `[Plugin Error] ${name}`,
                    e
                )

                try {

                    let errorText =
                        format(e)

                    if (
                        global.APIKeys
                    ) {

                        for (
                            const key of
                            Object.values(
                                global.APIKeys
                            )
                        ) {

                            if (!key)
                                continue

                            errorText =
                                errorText.replace(
                                    new RegExp(
                                        String(key),
                                        'g'
                                    ),
                                    '#HIDDEN#'
                                )
                        }
                    }

                    await m.reply(
                        errorText
                    )

                } catch {}
            }

            /*
             * =================================
             * AFTER
             * =================================
             */

            finally {

                if (
                    typeof plugin.after ===
                    'function'
                ) {

                    try {

                        await plugin.after.call(
                            this,
                            m,
                            extra
                        )

                    } catch (e) {

                        console.error(
                            `[Plugin After Error] ${name}`,
                            e
                        )
                    }
                }

                if (
                    m.diamond
                ) {

                    try {

                        await m.reply(
                            `تم استهلاك *${+m.diamond}* 💎`
                        )

                    } catch {}
                }
            }

            /*
             * One command only
             */

            break
        }

    } catch (e) {

        console.error(
            '[Handler Error]',
            e
        )

    } finally {

        /*
         * =====================================
         * USER UPDATE
         * =====================================
         */

        try {

            if (
                m &&
                m.sender
            ) {

                const user =
                    global.db.data.users[
                        m.sender
                    ]

                if (user) {

                    user.exp =
                        (
                            user.exp || 0
                        ) +
                        (
                            m.exp || 0
                        )

                    if (
                        m.diamond
                    ) {

                        user.diamond =
                            (
                                user.diamond || 0
                            ) -
                            (
                                m.diamond * 1
                            )
                    }
                }
            }

        } catch (e) {

            console.error(
                'User update error:',
                e
            )
        }

        /*
         * =====================================
         * GROUP STATS
         * =====================================
         *
         * statsMsg ديال Group فقط،
         * ولكن handler نفسه كيخدم فالخاص.
         */

        try {

            if (
                m?.isGroup &&
                m.sender
            ) {

                const statsMsg =
                    global.db.data
                        .statsMsg || {}

                const chatId =
                    m.chat

                const userId =
                    m.sender

                if (
                    !statsMsg[chatId]
                ) {

                    statsMsg[chatId] =
                        {}
                }

                if (
                    !statsMsg[
                        chatId
                    ][userId]
                ) {

                    statsMsg[
                        chatId
                    ][userId] = 0
                }

                statsMsg[
                    chatId
                ][userId] += 1

                global.db.data.statsMsg =
                    statsMsg
            }

        } catch {}

        /*
         * =====================================
         * PLUGIN STATS
         * =====================================
         */

        try {

            if (
                m?.plugin
            ) {

                const stats =
                    global.db.data.stats

                const now =
                    Date.now()

                let stat

                if (
                    stats[m.plugin]
                ) {

                    stat =
                        stats[m.plugin]

                } else {

                    stat =
                        stats[m.plugin] = {

                            total: 0,
                            success: 0,

                            last: 0,
                            lastSuccess: 0
                        }
                }

                stat.total += 1
                stat.last = now

                if (
                    !m.error
                ) {

                    stat.success += 1
                    stat.lastSuccess =
                        now
                }
            }

        } catch {}

        /*
         * =====================================
         * PRINT
         * =====================================
         */

        try {

            const opts =
                global.opts || {}

            if (
                !opts.noprint
            ) {

                const print =
                    (
                        await import(
                            './lib/print.js'
                        )
                    ).default

                await print(
                    m,
                    this
                )
            }

        } catch (e) {

            console.log(
                m,
                m?.quoted,
                e
            )
        }

        /*
         * =====================================
         * AUTOREAD
         * =====================================
         */

        try {

            const opts =
                global.opts || {}

            if (
                opts.autoread &&
                m?.chat
            ) {

                await this.chatRead(
                    m.chat,
                    m.isGroup
                        ? m.sender
                        : undefined,
                    m.id ||
                    m.key?.id
                ).catch(
                    () => {}
                )
            }

        } catch {}
    }
}


/*
 * =========================================
 * PARTICIPANTS UPDATE
 * =========================================
 */

export async function participantsUpdate({
    id,
    participants,
    action
}) {

    const opts =
        global.opts || {}

    if (opts.self)
        return

    if (
        global.db.data == null
    ) {

        await global.loadDatabase()
    }

    const chat =
        global.db.data.chats[id] ||
        {}

    const normalize =
        p =>
            typeof p === 'string'
                ? p
                : p?.id

    switch (action) {

        case 'add':
        case 'remove': {

            if (!chat.welcome)
                break

            const groupMetadata =
                await this
                    .groupMetadata(id)
                    .catch(
                        () => null
                    ) ||
                (
                    global.conn
                        ?.chats?.[id]
                        ?.metadata
                )

            if (!groupMetadata)
                return

            for (
                const participant of
                participants
            ) {

                const user =
                    normalize(
                        participant
                    )

                if (!user)
                    continue

                let pp =
                    global.fg_avatar ||
                    'https://i.ibb.co/fkFmQC2/eve.jpg'

                let ppgp =
                    global.fg_avatar ||
                    'https://i.ibb.co/fkFmQC2/eve.jpg'

                try {

                    pp =
                        await this.profilePictureUrl(
                            user,
                            'image'
                        )

                } catch {}

                try {

                    ppgp =
                        await this.profilePictureUrl(
                            id,
                            'image'
                        )

                } catch {}

                const baseText =
                    action === 'add'
                        ? (
                            chat.sWelcome ||
                            this.welcome ||
                            global.conn?.welcome ||
                            'مرحباً بك، @user'
                        )
                        : (
                            chat.sBye ||
                            this.bye ||
                            global.conn?.bye ||
                            'وداعاً، @user'
                        )

                const text =
                    baseText
                        .replace(
                            '@group',
                            await this.getName(id)
                        )
                        .replace(
                            '@desc',
                            groupMetadata.desc
                                ?.toString() ||
                            'غير متوفر'
                        )
                        .replace(
                            '@user',
                            '@' +
                            user.split('@')[0]
                        )

                try {

                    let imageUrl =
                        action === 'add'
                            ? global.API(
                                'fgmods',
                                '/api/welcome',
                                {
                                    username:
                                        await this.getName(
                                            user
                                        ),
                                    groupname:
                                        await this.getName(
                                            id
                                        ),
                                    groupicon:
                                        ppgp,
                                    membercount:
                                        groupMetadata
                                            .participants
                                            ?.length ||
                                        0,
                                    profile:
                                        pp,
                                    background:
                                        'https://i.ibb.co/fkFmQC2/eve.jpg'
                                },
                                'apikey'
                            )
                            : global.API(
                                'fgmods',
                                '/api/goodbye2',
                                {
                                    username:
                                        await this.getName(
                                            user
                                        ),
                                    groupname:
                                        await this.getName(
                                            id
                                        ),
                                    groupicon:
                                        ppgp,
                                    membercount:
                                        groupMetadata
                                            .participants
                                            ?.length ||
                                        0,
                                    profile:
                                        pp,
                                    background:
                                        'https://i.ibb.co/jh9367t/akali.jpg'
                                },
                                'apikey'
                            )

                    await this.sendFile(
                        id,
                        imageUrl,
                        'welcome.jpg',
                        text,
                        null,
                        false,
                        {
                            mentions: [user]
                        }
                    )

                } catch {

                    await this.sendFile(
                        id,
                        pp,
                        'profile.jpg',
                        text,
                        null,
                        false,
                        {
                            mentions: [user]
                        }
                    )
                }
            }

            break
        }

        case 'promote':
        case 'demote': {

            if (!chat.detect)
                break

            for (
                const participant of
                participants
            ) {

                const user =
                    normalize(
                        participant
                    )

                if (!user)
                    continue

                const pp =
                    await this
                        .profilePictureUrl(
                            user,
                            'image'
                        )
                        .catch(
                            () =>
                                global.fg_avatar
                        )

                let text =
                    action === 'promote'
                        ? (
                            chat.sPromote ||
                            this.spromote ||
                            global.conn?.spromote ||
                            '@user أصبح الآن مشرفاً في المجموعة 🛡️'
                        )
                        : (
                            chat.sDemote ||
                            this.sdemote ||
                            global.conn?.sdemote ||
                            '@user تم تنزيله من الإشراف'
                        )

                text =
                    text.replace(
                        '@user',
                        '@' +
                        user.split('@')[0]
                    )

                await this.sendFile(
                    id,
                    pp,
                    'pp.jpg',
                    text,
                    null,
                    false,
                    {
                        mentions: [user]
                    }
                )
            }

            break
        }
    }
}


/*
 * =========================================
 * GROUPS UPDATE
 * =========================================
 */

export async function groupsUpdate(groupsUpdate) {

    const opts =
        global.opts || {}

    if (opts.self)
        return

    for (
        const groupUpdate of
        groupsUpdate
    ) {

        const id =
            groupUpdate.id

        if (!id)
            continue

        const chats =
            global.db.data.chats[id]

        if (
            !chats?.detect
        ) {
            continue
        }

        let text = ''

        if (
            groupUpdate.desc
        ) {

            text =
                (
                    chats.sDesc ||
                    this.sDesc ||
                    global.conn?.sDesc ||
                    ''
                )
                    .replace(
                        '@desc',
                        groupUpdate.desc
                    )
        }

        if (
            groupUpdate.subject
        ) {

            text =
                (
                    chats.sSubject ||
                    this.sSubject ||
                    global.conn?.sSubject ||
                    ''
                )
                    .replace(
                        '@group',
                        groupUpdate.subject
                    )
        }

        if (
            groupUpdate.icon
        ) {

            text =
                (
                    chats.sIcon ||
                    this.sIcon ||
                    global.conn?.sIcon ||
                    ''
                )
                    .replace(
                        '@icon',
                        groupUpdate.icon
                    )
        }

        if (
            groupUpdate.revoke
        ) {

            text =
                (
                    chats.sRevoke ||
                    this.sRevoke ||
                    global.conn?.sRevoke ||
                    ''
                )
                    .replace(
                        '@revoke',
                        groupUpdate.revoke
                    )
        }

        if (!text)
            continue

        await this.sendMessage(
            id,
            {
                text,
                mentions:
                    this.parseMention
                        ? this.parseMention(text)
                        : []
            }
        )
    }
}


/*
 * =========================================
 * DELETE UPDATE
 * =========================================
 */

export async function deleteUpdate(update) {

    try {

        const {
            key,
            update: msgUpdate
        } = update || {}

        if (!key || !msgUpdate)
            return

        const {
            remoteJid,
            id,
            participant,
            fromMe
        } = key

        if (fromMe)
            return

        const isDelete =
            msgUpdate?.message
                ?.protocolMessage
                ?.type === 0 ||
            msgUpdate?.messageStubType === 1

        if (!isDelete)
            return

        const raw =
            await this.loadMessage(
                remoteJid,
                id
            )

        if (
            !raw ||
            !raw.message
        ) {
            return
        }

        if (!raw.key)
            raw.key = {}

        if (
            raw.key.fromMe ===
            undefined
        ) {

            raw.key.fromMe = false
        }

        const msg =
            this.serializeM
                ? this.serializeM(raw)
                : raw

        const chat =
            global.db.data
                .chats?.[
                    msg.chat
                ] || {}

        if (chat.delete)
            return

        const user =
            participant ||
            remoteJid

        const pushName =
            msg.pushName ||
            'غير معروف'

        const type =
            Object.keys(
                msg.message || {}
            )[0] ||
            'غير معروف'

        const text =
            msg.text ||
            msg.message
                ?.conversation ||
            msg.message
                ?.extendedTextMessage
                ?.text ||
            'بدون نص'

        const info = `
≡ *استرجاع الرسائل المحذوفة*

┌─⊷ 📌 *المستخدم*
▢ *الرقم* : @${user.split('@')[0]}
└─────────────
┌─⊷ 💬 *الرسالة*
▢ *النوع* : ${type}
▢ *المحتوى* :👇🏻
└───────────
`.trim()

        await this.reply(
            msg.chat,
            info,
            msg,
            {
                mentions: [user]
            }
        )

        await this.copyNForward(
            msg.chat,
            raw
        ).catch(
            e =>
                console.log(
                    'Forward error:',
                    e
                )
        )

    } catch (e) {

        console.error(
            'Error en deleteUpdate:',
            e
        )
    }
}


/*
 * =========================================
 * DFAIL
 * =========================================
 */

global.dfail =
    (type, m, conn) => {

        const msg = {

            rowner:
                `👑 هذا الأمر مخصص فقط لـ *مطور البوت* الأساسي.`,

            owner:
                `🔱 هذا الأمر مخصص فقط لـ *المطورين* (Owner / Sub Bots).`,

            mods:
                `🔰 هذه الميزة مخصصة فقط لـ *مشرفي البوت*.`,

            premium:
                `💠 هذا الأمر مخصص للأعضاء *المميزين (Premium)* فقط.\n\n` +
                `اكتب */premium* لمزيد من المعلومات.`,

            group:
                `⚙️ يمكن استخدام هذا الأمر في *المجموعات* فقط.`,

            private:
                `📮 يمكن استخدام هذا الأمر في *الخاص* فقط.`,

            admin:
                `🛡️ هذا الأمر مخصص فقط لـ *مشرفي المجموعة*.`,

            botAdmin:
                `💥 يجب أن يكون البوت *مشرفاً* لاستخدام هذا الأمر!`,

            unreg:
                `📇 الرجاء التسجيل أولاً لاستخدام هذه الميزة. للبدء اكتب:\n\n*/reg*`,

            restrict:
                `🔐 هذه الميزة *معطلة* حالياً.`
        }[type]

        if (!msg)
            return

        return m.reply(
            msg
        )
    }


/*
 * =========================================
 * HOT RELOAD
 * =========================================
 */

const file =
    global.__filename(
        import.meta.url,
        true
    )

watchFile(
    file,
    async () => {

        unwatchFile(file)

        console.log(
            chalk.magenta(
                "✅ تم تحديث 'handler.js'"
            )
        )

        if (
            global.reloadHandler
        ) {

            console.log(
                await global.reloadHandler()
            )
        }
    }
)