import axios from 'axios'

let handler = async (m, { conn }) => {
  try {
    const page = await axios.get('https://ibb.co/hJszTg0K')

    const match = page.data.match(
      /<meta property="og:image" content="([^"]+)"/i
    )

    if (!match) throw 'Image not found'

    const imageUrl = match[1]

    await conn.sendMessage(
      m.chat,
      {
        image: { url: imageUrl },
        caption: `
╭━━━〔 📥 أوامر التنزيل 〕━━━╮

> 🎵 .play {هذا لتنزيل اغاني من يوتيب}
> 🪩 .t {هذا للترجمعة نحو جميع لغات}
> 🧬 .tomp3 {هذا لتحويل المقطع الى صوت}
> 🤍 <url>  ويمكنك تنزيل الفديوهات خاصة ب{ instagram /facebook/tiktok/youtube }عن طريق ارسال الرابط مباشرة دون امر

╰━━━━━━━━━━━━━━━━━━╯
`
      },
      { quoted: m }
    )

  } catch (e) {
    console.error(e)
    m.reply('❌ فشل إرسال الصورة')
  }
}

handler.command = ['menu']
handler.help = ['menu']
handler.tags = ['main']

export default handler
