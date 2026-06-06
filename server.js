require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;
const LLM_URL = process.env.LLM_URL || 'https://api.deepseek.com/chat/completions';
const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  console.error('FATAL: API_KEY не задан. Создай .env с API_KEY=sk-...');
  process.exit(1);
}

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

app.listen(PORT, () => {
  console.log('Сервер запущен: http://localhost:' + PORT);
});
