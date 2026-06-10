import { geminichat } from 'notmebotz-tools';

const handler = async (m, { conn, text }) => {
  if (!text) return m.reply('📝 اكتب نصاً ليتم توليد الرد عليه.');

  try {
    // إظهار حالة "يكتب..."
    await conn.sendPresenceUpdate('composing', m.chat);

    const response = await geminichat(text);

    if (response && response.msg) {
      await conn.sendMessage(m.chat, {
        text: `${response.msg.trim()}`,
      }, { quoted: m });
    } else {
      m.reply('⚠️ لم يتم العثور على رسالة مناسبة.');
    }
  } catch (error) {
    console.error(error);
    m.reply('❌ حدث خطأ أثناء المعالجة.');
  }
};

handler.command = /^ai$/i;
export default handler;