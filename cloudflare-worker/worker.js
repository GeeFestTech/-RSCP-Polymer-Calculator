// Cloudflare Worker: принимает POST с ценами от кнопки "Сохранить для всех"
// на сайте калькулятора и коммитит их в prices.json репозитория GitHub.
//
// Секреты (задаются в Cloudflare, НИКОГДА не хранятся в этом файле):
//   GITHUB_TOKEN  — fine-grained PAT с правом Contents: Read and write только на этот репозиторий
//   SAVE_PASSWORD — пароль, который вводит пилот при нажатии "Сохранить для всех"
//
// Настройки репозитория — поменяй, если репозиторий/ветка/путь изменятся.
const ALLOWED_ORIGIN = "https://geefesttech.github.io";
const GITHUB_OWNER = "GeeFestTech";
const GITHUB_REPO = "-RSCP-Polymer-Calculator";
const GITHUB_BRANCH = "main";
const FILE_PATH = "prices.json";

function corsHeaders() {
    return {
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    };
}

function json(obj, status = 200) {
    return new Response(JSON.stringify(obj), {
        status,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
    });
}

export default {
    async fetch(request, env) {
        if (request.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders() });
        }
        if (request.method !== "POST") {
            return json({ error: "Method not allowed" }, 405);
        }

        let body;
        try {
            body = await request.json();
        } catch (e) {
            return json({ error: "Некорректный JSON в запросе" }, 400);
        }

        const { password, resourcePrices, polymerPrices } = body || {};

        if (!password || password !== env.SAVE_PASSWORD) {
            return json({ error: "Неверный пароль" }, 401);
        }
        if (!resourcePrices || typeof resourcePrices !== "object" || !polymerPrices || typeof polymerPrices !== "object") {
            return json({ error: "Некорректные данные цен" }, 400);
        }

        const newContent = JSON.stringify({ resourcePrices, polymerPrices }, null, 2);

        const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}`;
        const ghHeaders = {
            "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
            "User-Agent": "eve-polymer-calc-price-sync",
            "Accept": "application/vnd.github+json",
        };

        // 1. Узнаём sha текущего файла — GitHub требует его для обновления существующего файла
        let sha;
        const getRes = await fetch(`${apiUrl}?ref=${GITHUB_BRANCH}`, { headers: ghHeaders });
        if (getRes.ok) {
            const getData = await getRes.json();
            sha = getData.sha;
        } else if (getRes.status !== 404) {
            return json({ error: "Не удалось прочитать текущий prices.json из GitHub (код " + getRes.status + ")" }, 502);
        }

        // 2. Пишем новое содержимое (создаёт коммит в репозитории)
        const putBody = {
            message: "Обновление заводских цен через калькулятор",
            content: btoa(unescape(encodeURIComponent(newContent))),
            branch: GITHUB_BRANCH,
        };
        if (sha) putBody.sha = sha;

        const putRes = await fetch(apiUrl, {
            method: "PUT",
            headers: { ...ghHeaders, "Content-Type": "application/json" },
            body: JSON.stringify(putBody),
        });

        if (!putRes.ok) {
            const errText = await putRes.text();
            return json({ error: "GitHub отклонил запись: " + errText }, 502);
        }

        const putData = await putRes.json();
        return json({ success: true, commitUrl: putData.commit && putData.commit.html_url });
    },
};
