import axios from 'axios'

const tiktokRegex =
/^https?:\/\/(?:www\.)?(?:tiktok\.com|vt\.tiktok\.com|vm\.tiktok\.com)\/\S+$/i

export async function before(m, { conn }) {
  if (!m.text) return

  const text = m.text.trim()

  // خاص الرسالة تكون غير رابط TikTok
  if (!tiktokRegex.test(text)) return

  try {
    await m.react('⏳️');

    const encodedParams = new URLSearchParams()
    encodedParams.set('url', text)
    encodedParams.set('hd', '2')

    const response = await axios({
      method: 'POST',
      url: 'https://tikwm.com/api/',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Cookie': 'current_language=en',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36'
      },
      data: encodedParams
    })

    const res = response.data?.data

    if (!res?.play) return

    await conn.sendFile(
      m.chat,
      res.play,
      'tiktok.mp4',
      '',
      m
    )
await m.react('🤍');
  } catch (e) {
    console.error('TIKTOK AUTO ERROR:', e)
  }
}