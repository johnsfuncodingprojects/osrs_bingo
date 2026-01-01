import { supabase } from "@/lib/supabase";

export async function uploadClaimImage(file: File, userId: string) {
  if (!file.type.startsWith("image/")) throw new Error("Image files only.");

  const ext = file.name.split(".").pop()?.toLowerCase() || "png";
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage.from("claims").upload(path, file, {
    upsert: false,
    contentType: file.type,
    cacheControl: "3600",
  });

  if (error) throw error;
  return path;
}

export async function getSignedClaimUrl(path: string, expiresInSec = 60 * 60) {
  const { data, error } = await supabase.storage
    .from("claims")
    .createSignedUrl(path, expiresInSec);

  if (error) throw error;
  return data.signedUrl;
}
