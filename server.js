require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const https = require('https');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

const LLM_URL = process.env.LLM_URL || 'https://api.deepseek.com/chat/completions';
const API_KEY = process.env.DEEPSEEK_API_KEY || process.env.API_KEY;
const QWEN_API_KEY = process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY;
const QWEN_BASE_URL = process.env.QWEN_BASE_URL;
const GIGA_AUTH_KEY = process.env.GIGA_AUTH_KEY;

// GigaChat использует самоподписанный сертификат
const gigaAgent = new https.Agent({ rejectUnauthorized: false });

app.use(express.json());
app.use(express.static('public'));

app.post('/api/chat', async (req, res) => {
  try {
    const response = await fetch(LLM_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + API_KEY,
      },
      body: JSON.stringify(req.body),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

app.post('/api/qwen', async (req, res) => {
  try {
    const qwenUrl = (QWEN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1') + '/chat/completions';
    const response = await fetch(qwenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + QWEN_API_KEY,
      },
      body: JSON.stringify(req.body),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

let gigaToken = null;
let gigaTokenExpires = 0;

async function getGigaToken() {
  if (gigaToken && Date.now() < gigaTokenExpires) return gigaToken;

  // GIGA_AUTH_KEY уже в base64, передаём как есть
  const res = await fetch('https://ngw.devices.sberbank.ru:9443/api/v2/oauth', {
    method: 'POST',
    agent: gigaAgent,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
      'Authorization': 'Basic ' + GIGA_AUTH_KEY,
      'RqUID': crypto.randomUUID(),
    },
    body: 'scope=GIGACHAT_API_PERS',
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error('GigaChat OAuth failed (' + res.status + '): ' + body);
  }

  const data = await res.json();
  gigaToken = data.access_token;

  // expires_at может быть в секундах (>1000000000000 — уже мс)
  const expiresIn = data.expires_at
    ? (data.expires_at > 1000000000000 ? data.expires_at : data.expires_at * 1000)
    : Date.now() + 30 * 60 * 1000;
  gigaTokenExpires = expiresIn - 60000; // запас 1 минута

  return gigaToken;
}

app.post('/api/giga', async (req, res) => {
  try {
    const token = await getGigaToken();
    const body = { ...req.body, model: 'GigaChat' };

    const response = await fetch('https://gigachat.devices.sberbank.ru/api/v1/chat/completions', {
      method: 'POST',
      agent: gigaAgent,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': 'Bearer ' + token,
      },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

app.listen(PORT, () => {
  console.log('Сервер запущен: http://localhost:' + PORT);
});
