import { useEffect, useState } from "react";
import { supabase } from "../supabaseService"; // Adjust this path depending on your folder layout

export function useSynchronizedData(tableName: string = "app_data") {
  const [dataItems, setDataItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 1. Fetch current dynamic records from database
    const fetchRecords = async () => {
      try {
        const { data, error } = await supabase
          .from(tableName)
          .select("*")
          .order("created_at", { ascending: false });
          
        if (error) throw error;
        if (data) setDataItems(data);
      } catch (err) {
        console.error(`Error fetching data from ${tableName}:`, err);
      } finally {
        setLoading(false);
      }
    };
    
    fetchRecords();

    // 2. Listen to real-time additions/deletions automatically
    const dataSubscription = supabase
      .channel(`${tableName}-sync-channel`)
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
      supabase.removeChannel(dataSubscription);
    };
  }, [tableName]);

  return { dataItems, loading };
}
