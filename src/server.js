require('dotenv').config();
const express = require('express');
const path = require('path');

const apiRoutes = require('./routes/api');
const updateRoutes = require('./routes/update');
const { startCron } = require('./cron');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api', apiRoutes);
app.use(updateRoutes); // menyediakan GET/POST /u/:token

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'dashboard.html'));
});

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server jalan di port ${PORT}`);
  startCron();
});
