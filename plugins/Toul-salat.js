import puppeteer from 'puppeteer';

const handler = async (m, { conn }) => {
  const url = 'https://prayertimes.me/Rabat.html';

  m.reply('⏳ جارٍ التقاط مواقيت الصلاة من الموقع، انتظر لحظة...');

  try {
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 0 });

    const buffer = await page.screenshot({ fullPage: true });
    await browser.close();

    await conn.sendMessage(m.chat, {
      image: buffer,
      caption: `✅ هذه صورة من موقع مواقيت الصلاة في الرباط:\n${url}`
    }, { quoted: m });

  } catch (err) {
    console.error(err);
    m.reply('حدث خطأ أثناء التقاط الصورة من الموقع.');
  }
};

handler.customPrefix = /^(1|slt|salat|A?$)/i;
handler.command = /^(1|slt|salat|A?$)/i;

export default handler;