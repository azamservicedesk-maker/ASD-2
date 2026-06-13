import express from 'express';
import { PrismaClient } from '@prisma/client';

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// 1. The Automated Health Check Endpoint
app.get('/health', async (req, res) => {
  try {
    // This pings your Neon database to make sure it's alive
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: 'UP', database: 'CONNECTED' });
  } catch (error) {
    res.status(500).json({ status: 'DOWN', error: 'Database connection failed' });
  }
});

// 2. A test endpoint to make sure you can read from the DB
app.get('/users', async (req, res) => {
  try {
    const users = await prisma.user.findMany();
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Could not fetch users' });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
