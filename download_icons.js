import fs from 'fs';
import https from 'https';
import path from 'path';

const html = `
<li data-search="İngilizce">
<a class="list-item" href="/ders/ingilizce/turkiye/">
<img class="icon" src="//c.superprof.com/img/ico/mat/224.svg" alt="subject icon">
<span class="name">İngilizce</span>
</a></li>
<li data-search="Matematik">
<a class="list-item" href="/ders/matematik/turkiye/">
<img class="icon" src="//c.superprof.com/img/ico/mat/13.svg" alt="subject icon">
<span class="name">Matematik</span>
</a></li>
<li data-search="Almanca">
<a class="list-item" href="/ders/almanca/turkiye/">
<img class="icon" src="//c.superprof.com/img/ico/mat/33.svg" alt="subject icon">
<span class="name">Almanca</span>
</a></li>
<li data-search="Piyano">
<a class="list-item" href="/ders/piyano/turkiye/">
<img class="icon" src="//c.superprof.com/img/ico/mat/132.svg" alt="subject icon">
<span class="name">Piyano</span>
</a></li>
<li data-search="Tenis">
<a class="list-item" href="/ders/tenis/turkiye/">
<img class="icon" src="//c.superprof.com/img/ico/mat/168.svg" alt="subject icon">
<span class="name">Tenis</span>
</a></li>
<li data-search="Gitar">
<a class="list-item" href="/ders/gitar/turkiye/">
<img class="icon" src="//c.superprof.com/img/ico/mat/123.svg" alt="subject icon">
<span class="name">Gitar</span>
</a></li>
<li data-search="Yüzme">
<a class="list-item" href="/ders/yuzme/turkiye/">
<img class="icon" src="//c.superprof.com/img/ico/mat/156.svg" alt="subject icon">
<span class="name">Yüzme</span>
</a></li>
<li data-search="Resim">
<a class="list-item" href="/ders/resim/turkiye/">
<img class="icon" src="//c.superprof.com/img/ico/mat/181.svg" alt="subject icon">
<span class="name">Resim</span>
</a></li>
<li data-search="Türkçe">
<a class="list-item" href="/ders/turkce/turkiye/">
<img class="icon" src="//c.superprof.com/img/ico/mat/1635.svg" alt="subject icon">
<span class="name">Türkçe</span>
</a></li>
<li data-search="Personal Trainer">
<a class="list-item" href="/ders/spor-koclugu/turkiye/">
<img class="icon" src="//c.superprof.com/img/ico/mat/143.svg" alt="subject icon">
<span class="name">Personal Trainer</span>
</a></li>
<li data-search="Şan">
<a class="list-item" href="/ders/san/turkiye/">
<img class="icon" src="//c.superprof.com/img/ico/mat/116.svg" alt="subject icon">
<span class="name">Şan</span>
</a></li>
<li data-search="Arapça">
<a class="list-item" href="/ders/arapca/turkiye/">
<img class="icon" src="//c.superprof.com/img/ico/mat/34.svg" alt="subject icon">
<span class="name">Arapça</span>
</a></li>
<li data-search="Rusça">
<a class="list-item" href="/ders/rusca/turkiye/">
<img class="icon" src="//c.superprof.com/img/ico/mat/75.svg" alt="subject icon">
<span class="name">Rusça</span>
</a></li>
<li data-search="Fransızca">
<a class="list-item" href="/ders/fransizca/turkiye/">
<img class="icon" src="//c.superprof.com/img/ico/mat/51.svg" alt="subject icon">
<span class="name">Fransızca</span>
</a></li>
<li data-search="Keman">
<a class="list-item" href="/ders/keman/turkiye/">
<img class="icon" src="//c.superprof.com/img/ico/mat/137.svg" alt="subject icon">
<span class="name">Keman</span>
</a></li>
<li data-search="Direksiyon">
<a class="list-item" href="/ders/direksiyon/turkiye/">
<img class="icon" src="//c.superprof.com/img/ico/mat/1131.svg" alt="subject icon">
<span class="name">Direksiyon</span>
</a></li>
<li data-search="Fitness">
<a class="list-item" href="/ders/fitness/turkiye/">
<img class="icon" src="//c.superprof.com/img/ico/mat/default.svg" alt="subject icon">
<span class="name">Fitness</span>
</a></li>
<li data-search="Fizik">
<a class="list-item" href="/ders/fizik/turkiye/">
<img class="icon" src="//c.superprof.com/img/ico/mat/14.svg" alt="subject icon">
<span class="name">Fizik</span>
</a></li>
<li data-search="Bağlama">
<a class="list-item" href="/ders/baglama/turkiye/">
<img class="icon" src="//c.superprof.com/img/ico/mat/default.svg" alt="subject icon">
<span class="name">Bağlama</span>
</a></li>
<li data-search="Eğitim koçluğu">
<a class="list-item" href="/ders/egitim-koclugu/turkiye/">
<img class="icon" src="//c.superprof.com/img/ico/mat/580.svg" alt="subject icon">
<span class="name">Eğitim koçluğu</span>
</a></li>
<li data-search="Satranç">
<a class="list-item" href="/ders/satranc/turkiye/">
<img class="icon" src="//c.superprof.com/img/ico/mat/200.svg" alt="subject icon">
<span class="name">Satranç</span>
</a></li>
<li data-search="Kuran">
<a class="list-item" href="/ders/kuran/turkiye/">
<img class="icon" src="//c.superprof.com/img/ico/mat/default.svg" alt="subject icon">
<span class="name">Kuran</span>
</a></li>
<li data-search="Yoga">
<a class="list-item" href="/ders/yoga/turkiye/">
<img class="icon" src="//c.superprof.com/img/ico/mat/171.svg" alt="subject icon">
<span class="name">Yoga</span>
</a></li>
<li data-search="Kimya">
<a class="list-item" href="/ders/kimya/turkiye/">
<img class="icon" src="//c.superprof.com/img/ico/mat/15.svg" alt="subject icon">
<span class="name">Kimya</span>
</a></li>
<li data-search="Fen bilimleri">
<a class="list-item" href="/ders/fen-bilimleri/turkiye/">
<img class="icon" src="//c.superprof.com/img/ico/mat/default.svg" alt="subject icon">
<span class="name">Fen bilimleri</span>
</a></li>
<li data-search="İspanyolca">
<a class="list-item" href="/ders/ispanyolca/turkiye/">
<img class="icon" src="//c.superprof.com/img/ico/mat/48.svg" alt="subject icon">
<span class="name">İspanyolca</span>
</a></li>
<li data-search="Elektro gitar">
<a class="list-item" href="/ders/elektronik-gitar/turkiye/">
<img class="icon" src="//c.superprof.com/img/ico/mat/515.svg" alt="subject icon">
<span class="name">Elektro gitar</span>
</a></li>
<li data-search="Pilates">
<a class="list-item" href="/ders/pilates/turkiye/">
<img class="icon" src="//c.superprof.com/img/ico/mat/default.svg" alt="subject icon">
<span class="name">Pilates</span>
</a></li>
<li data-search="Futbol">
<a class="list-item" href="/ders/futbol/turkiye/">
<img class="icon" src="//c.superprof.com/img/ico/mat/148.svg" alt="subject icon">
<span class="name">Futbol</span>
</a></li>
<li data-search="Tarih">
<a class="list-item" href="/ders/tarih/turkiye/">
<img class="icon" src="//c.superprof.com/img/ico/mat/638.svg" alt="subject icon">
<span class="name">Tarih</span>
</a></li>
<li data-search="Diksiyon">
<a class="list-item" href="/ders/diksiyon/turkiye/">
<img class="icon" src="//c.superprof.com/img/ico/mat/default.svg" alt="subject icon">
<span class="name">Diksiyon</span>
</a></li>
<li data-search="Kuran okuma">
<a class="list-item" href="/ders/kuran-okuma/turkiye/">
<img class="icon" src="//c.superprof.com/img/ico/mat/default.svg" alt="subject icon">
<span class="name">Kuran okuma</span>
</a></li>
<li data-search="Yaşam koçluğu">
<a class="list-item" href="/ders/yasam-koclugu/turkiye/">
<img class="icon" src="//c.superprof.com/img/ico/mat/1098.svg" alt="subject icon">
<span class="name">Yaşam koçluğu</span>
</a></li>
<li data-search="Psikoloji">
<a class="list-item" href="/ders/psikoloji/turkiye/">
<img class="icon" src="//c.superprof.com/img/ico/mat/102.svg" alt="subject icon">
<span class="name">Psikoloji</span>
</a></li>
<li data-search="Dans">
<a class="list-item" href="/ders/dans/turkiye/">
<img class="icon" src="//c.superprof.com/img/ico/mat/1808.svg" alt="subject icon">
<span class="name">Dans</span>
</a></li>
<li data-search="AutoCAD">
<a class="list-item" href="/ders/autocad/turkiye/">
<img class="icon" src="//c.superprof.com/img/ico/mat/374.svg" alt="subject icon">
<span class="name">AutoCAD</span>
</a></li>
<li data-search="Biyoloji">
<a class="list-item" href="/ders/biyoloji/turkiye/">
<img class="icon" src="//c.superprof.com/img/ico/mat/10.svg" alt="subject icon">
<span class="name">Biyoloji</span>
</a></li>
<li data-search="Boks">
<a class="list-item" href="/ders/boks/turkiye/">
<img class="icon" src="//c.superprof.com/img/ico/mat/142.svg" alt="subject icon">
<span class="name">Boks</span>
</a></li>
<li data-search="İtalyanca">
<a class="list-item" href="/ders/italyanca/turkiye/">
<img class="icon" src="//c.superprof.com/img/ico/mat/57.svg" alt="subject icon">
<span class="name">İtalyanca</span>
</a></li>
<li data-search="Din kültürü ve ahlak bilgisi">
<a class="list-item" href="/ders/din-bilimleri/turkiye/">
<img class="icon" src="//c.superprof.com/img/ico/mat/default.svg" alt="subject icon">
<span class="name">Din kültürü ve ahlak bilgisi</span>
</a></li>
<li data-search="Coğrafya">
<a class="list-item" href="/ders/cografya/turkiye/">
<img class="icon" src="//c.superprof.com/img/ico/mat/99.svg" alt="subject icon">
<span class="name">Coğrafya</span>
</a></li>
<li data-search="Mimari">
<a class="list-item" href="/ders/mimari/turkiye/">
<img class="icon" src="//c.superprof.com/img/ico/mat/174.svg" alt="subject icon">
<span class="name">Mimari</span>
</a></li>
<li data-search="Japonca">
<a class="list-item" href="/ders/japonca/turkiye/">
<img class="icon" src="//c.superprof.com/img/ico/mat/58.svg" alt="subject icon">
<span class="name">Japonca</span>
</a></li>
<li data-search="Okul öncesi eğitim">
<a class="list-item" href="/ders/okul-oncesi-egitim/turkiye/">
<img class="icon" src="//c.superprof.com/img/ico/mat/default.svg" alt="subject icon">
<span class="name">Okul öncesi eğitim</span>
</a></li>
<li data-search="Korece">
<a class="list-item" href="/ders/korece/turkiye/">
<img class="icon" src="//c.superprof.com/img/ico/mat/44.svg" alt="subject icon">
<span class="name">Korece</span>
</a></li>
<li data-search="İngilizce konuşma becerileri">
<a class="list-item" href="/ders/ingilizce-konusma-becerileri/turkiye/">
<img class="icon" src="//c.superprof.com/img/ico/mat/723.svg" alt="subject icon">
<span class="name">İngilizce konuşma becerileri</span>
</a></li>
<li data-search="Müzik eğitimi">
<a class="list-item" href="/ders/muzik-egitimi/turkiye/">
<img class="icon" src="//c.superprof.com/img/ico/mat/default.svg" alt="subject icon">
<span class="name">Müzik eğitimi</span>
</a></li>
<li data-search="Bateri">
<a class="list-item" href="/ders/bateri/turkiye/">
<img class="icon" src="//c.superprof.com/img/ico/mat/115.svg" alt="subject icon">
<span class="name">Bateri</span>
</a></li>
<li data-search="Yabancılar için Türkçe">
<a class="list-item" href="/ders/yabancilar-icin-turkce/turkiye/">
<img class="icon" src="//c.superprof.com/img/ico/mat/84.svg" alt="subject icon">
<span class="name">Yabancılar için Türkçe</span>
</a></li>
<li data-search="Basketbol">
<a class="list-item" href="/ders/basketbol/turkiye/">
<img class="icon" src="//c.superprof.com/img/ico/mat/141.svg" alt="subject icon">
<span class="name">Basketbol</span>
</a></li>
`;

const regex = /<img class="icon" src="\/\/(c\.superprof\.com\/img\/ico\/mat\/([^"]+))"/g;
let match;
const urls = [];
while ((match = regex.exec(html)) !== null) {
  urls.push({
    url: 'https://' + match[1],
    filename: match[2]
  });
}

const dir = path.join(process.cwd(), 'frontend', 'public', 'icons', 'subjects');
if (!fs.existsSync(dir)){
    fs.mkdirSync(dir, { recursive: true });
}

// deduplicate
const uniqueUrls = [...new Map(urls.map(item => [item.filename, item])).values()];

async function download() {
  for (const item of uniqueUrls) {
    const dest = path.join(dir, item.filename);
    if (fs.existsSync(dest)) continue;
    
    await new Promise((resolve, reject) => {
      https.get(item.url, (res) => {
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on('finish', () => {
          file.close(resolve);
        });
      }).on('error', (err) => {
        fs.unlink(dest, () => reject(err));
      });
    });
  }
  
  // Create subjects JSON
  const regexName = /<img class="icon" src="\/\/c\.superprof\.com\/img\/ico\/mat\/([^"]+)".*?>\s*<span class="name">([^<]+)<\/span>/g;
  const subjectsData = [];
  let nameMatch;
  while ((nameMatch = regexName.exec(html)) !== null) {
    subjectsData.push({
      icon: nameMatch[1],
      name: nameMatch[2]
    });
  }
  // deduplicate
  const uniqueSubjects = [...new Map(subjectsData.map(item => [item.name, item])).values()];
  
  fs.writeFileSync(path.join(process.cwd(), 'frontend', 'src', 'components', 'subjects.json'), JSON.stringify(uniqueSubjects, null, 2));
  console.log('Downloaded all icons and created subjects.json!');
}

download();
