import translate from 'google-translate-api-x';

const handler = async (m, { conn, args, usedPrefix, command }) => {
    // جمع كافة الكلمات بعد الأمر
    let fullText = args.join(' ').trim();

    // دعم الترجمة في حالة الرد على رسالة (Quoted)
    if (!fullText && m.quoted && m.quoted.text) {
        fullText = m.quoted.text;
    }

    // إذا لم يكتب المستخدم أي نص
    if (!fullText) {
        return m.reply(`*هذا للترجمة*\n\n🧶يرجى كتابة النص المراد ترجمته.\n*مثال:* ${usedPrefix + command} hello`);
    }

    // التحقق مما إذا كانت الكلمة الأولى عبارة عن رمز لغة من حرفين (مثل ar, en, fr)
    const firstWord = args[0] ? args[0].toLowerCase() : '';
    const isLangCode = firstWord.length === 2;

    // === الحالة الأولى: تم تحديد اللغة (مثل .tr en hello أو عند الضغط على الزر) ===
    if (isLangCode && args.length > 1) {
        const targetLang = firstWord;
        const textToTranslate = args.slice(1).join(' ');

        try {
            const result = await translate(textToTranslate, { to: targetLang });
            await m.reply(result.text);
        } catch (error) {
            console.error('Translation Error:', error);
            await m.reply('حدث خطأ أثناء الترجمة. يرجى التأكد من أن رمز اللغة صحيح.');
        }

    // === الحالة الثانية: لم يتم تحديد اللغة (مثل .tr hello) -> إظهار الأزرار ===
    } else {
        const textToTranslate = fullText;

        // مصفوفة الأزرار مع الـ ID الخاص بكل زر
        const buttons = [
            {
                buttonId: `${usedPrefix + command} ar ${textToTranslate}`,
                buttonText: { displayText: '🇲🇦 العربية ' },
                type: 1
            },
            {
                buttonId: `${usedPrefix + command} en ${textToTranslate}`,
                buttonText: { displayText: '🇬🇧 الإنجليزية' },
                type: 1
            },
            {
                buttonId: `${usedPrefix + command} fr ${textToTranslate}`,
                buttonText: { displayText: '🇫🇷 الفرنسية' },
                type: 1
            }
        ];

        // تجهيز رسالة الأزرار
        const buttonMessage = {
            text: `📝 *🧶النص المراد ترجمته:*\n"${textToTranslate}"\n\nإختر اللغة التي تريد الترجمة إليها:`,
            footer: '🧶KOBY🧶',
            buttons: buttons,
            headerType: 1
        };

        // إرسال الأزرار للمستخدم
        await conn.sendMessage(m.chat, buttonMessage, { quoted: m });
    }
};

handler.command = ['tr'];

export default handler;
