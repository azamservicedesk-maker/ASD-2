import { useEffect, useState } from "react";
import { supabase } from "../supabaseService"; 

export function useSynchronizedData(tableName: string) {
  const [dataItems, setDataItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 1. Fetch current dynamic records from database immediately upon loading
    const fetchRecords = async () => {
      try {
        if (!supabase) return;
        const { data, error } = await supabase
          .from(tableName)
          .select("*")
          .order("created_at", { ascending: false });
          
        if (error) throw error;
        if (data) setDataItems(data);
      } catch (err) {
        console.error(`Error fetching data from table [${tableName}]:`, err);
      } finally {
        setLoading(false);
      }
    };
    
    fetchRecords();

    // 2. Listen to real-time additions/deletions on the database server automatically
    const dataSubscription = supabase
      .channel(`${tableName}-realtime-sync`)
      .on("postgres_changes", { event: "*", schema: "public", table: tableName }, (payload) => {
        if (payload.eventType === "INSERT") {
          setDataItems((prev) => [payload.new, ...prev]);
        } else if (payload.eventType === "DELETE") {
          setDataItems((prev) => prev.filter((item) => item.id !== payload.old.id));
        } else if (payload.eventType === "UPDATE") {
          setDataItems((prev) => prev.map((item) => item.id === payload.new.id ? payload.new : item));
        }
      })
      .subscribe();

    return () => {
      if (supabase) supabase.removeChannel(dataSubscription);
    };
  }, [tableName]);

  return { dataItems, loading };
}
