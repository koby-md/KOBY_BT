import { proto, generateWAMessage, areJidsSameUser } from '@whiskeysockets/baileys'

export function init(conn) {
    // ✅ كيعيد تسجيل الـ listener كل 5 ثواني
    setInterval(() => {
        conn.ev.removeAllListeners('messages.upsert')
        conn.ev.on('messages.upsert', async ({ messages, type }) => {
            for (let m of messages) {
                if (!m.message) continue
                if (!(
                    m.message.buttonsResponseMessage ||
                    m.message.templateButtonReplyMessage ||
                    m.message.listResponseMessage ||
                    m.message.interactiveResponseMessage ||
                    m.message.pollUpdateMessage
                )) continue

                let id = ''
                try {
                    const mtype = Object.keys(m.message)[0]
                    id =
                        mtype === 'buttonsResponseMessage'
                            ? m.message.buttonsResponseMessage.selectedButtonId
                        : mtype === 'listResponseMessage'
                            ? m.message.listResponseMessage.singleSelectReply.selectedRowId
                        : mtype === 'templateButtonReplyMessage'
                            ? m.message.templateButtonReplyMessage.selectedId
                        : mtype === 'interactiveResponseMessage'
                            ? JSON.parse(
                                m.message.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson ||
                                '{}'
                              )?.id
                        : ''
                } catch (e) {
                    console.log('parse error:', e)
                }

                if (!id) continue

                let fakeMsg = await generateWAMessage(
                    m.key.remoteJid,
                    { text: id },
                    { userJid: conn.user.jid }
                )

                fakeMsg.key.remoteJid = m.key.remoteJid
                fakeMsg.key.fromMe = areJidsSameUser(m.key.participant || m.key.remoteJid, conn.user.id)
                fakeMsg.key.id = m.key.id
                fakeMsg.pushName = m.pushName
                if (m.key.participant) {
                    fakeMsg.key.participant = fakeMsg.participant = m.key.participant
                }

                conn.ev.emit('messages.upsert', {
                    messages: [proto.WebMessageInfo.create(fakeMsg)].map(v => ((v.conn = conn), v)),
                    type: 'append'
                })
            }
        })
    }, 5000) // ✅ كل 5 ثواني يعيد التسجيل
}

export async function all(m, chatUpdate) {
    if (m.isBaileys) return
    if (!m.message) return

    if (!(
        m.message.buttonsResponseMessage ||
        m.message.templateButtonReplyMessage ||
        m.message.listResponseMessage ||
        m.message.interactiveResponseMessage ||
        m.message.pollUpdateMessage
    )) return

    let id = ''

    try {
        id =
            m.mtype === 'buttonsResponseMessage'
                ? m.message.buttonsResponseMessage.selectedButtonId
            : m.mtype === 'listResponseMessage'
                ? m.message.listResponseMessage.singleSelectReply.selectedRowId
            : m.mtype === 'templateButtonReplyMessage'
                ? m.message.templateButtonReplyMessage.selectedId
            : m.mtype === 'interactiveResponseMessage'
                ? JSON.parse(
                    m.msg?.nativeFlowResponseMessage?.paramsJson ||
                    m.msg?.paramsJson ||
                    '{}'
                  )?.id
            : m.text || ''
    } catch (e) {
        console.log('Button parse error:', e)
        id = m.text || ''
    }

    if (!id) return

    let messages = await generateWAMessage(
        m.chat,
        { text: id, mentions: m.mentionedJid },
        {
            userJid: this.user.jid,
            quoted: m.quoted && m.quoted.fakeObj
        }
    )

    messages.key.remoteJid = m.chat
    messages.key.fromMe = areJidsSameUser(m.sender, this.user.id)
    messages.key.id = m.key.id
    messages.pushName = m.pushName

    if (m.isGroup) {
        messages.key.participant = messages.participant = m.sender
    }

    this.ev.emit('messages.upsert', {
        ...chatUpdate,
        messages: [proto.WebMessageInfo.create(messages)].map(v => ((v.conn = this), v)),
        type: 'append'
    })
}