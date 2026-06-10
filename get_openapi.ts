import * as dotenv from "dotenv";
dotenv.config({ override: true });

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";

async function fetchOpenAPI() {
  const url = `${SUPABASE_URL}/rest/v1/`;
  try {
    const res = await fetch(url, {
      headers: {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`
      }
    });
    if (!res.ok) {
      console.error(`Fetch failed with status ${res.status}: ${await res.text()}`);
      return;
    }
    const spec = await res.json() as any;
    console.log("Tables in database:", Object.keys(spec.definitions || {}));
    if (spec.definitions && spec.definitions.users) {
      console.log("Users definition properties:", Object.keys(spec.definitions.users.properties || {}));
      console.log("Full Users properties description:", JSON.stringify(spec.definitions.users.properties, null, 2));
    } else {
      console.log("No users definition found in OpenAPI!");
    }
  } catch (err) {
    console.error("Error:", err);
  }
}

fetchOpenAPI();
