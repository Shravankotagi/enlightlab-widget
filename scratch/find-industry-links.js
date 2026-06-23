const axios = require('axios');
const cheerio = require('cheerio');

async function findLinks() {
  try {
    const { data } = await axios.get("https://enlightlab.com", {
      headers: { "User-Agent": "EnlightLabBot/1.0" }
    });
    const $ = cheerio.load(data);
    const links = new Set();
    
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (href && href.includes("enlightlab.com")) {
        links.add(href);
      } else if (href && href.startsWith("/")) {
        links.add("https://enlightlab.com" + href);
      }
    });

    console.log("--- Live Links Found ---");
    Array.from(links).sort().forEach(l => {
      if (l.includes("/our-industry/") || l.includes("/services/") || l.includes("/technology/") || l.includes("/about")) {
        console.log(l);
      }
    });
  } catch (err) {
    console.error("Error fetching homepage:", err.message);
  }
}

findLinks();
