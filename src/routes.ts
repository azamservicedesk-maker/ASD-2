import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();
const router = Router();
const prisma = new PrismaClient();

// Example of rewriting a route from Supabase to Prisma:
router.get('/data', async (req, res) => {
  try {
    // Instead of: const { data } = await supabase.from('User').select('*')
    const users = await prisma.user.findMany(); 
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
