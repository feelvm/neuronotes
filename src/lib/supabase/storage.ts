import { supabase, isSupabaseConfigured } from './client';

export interface UploadNoteImageResult {
    publicUrl: string;
    path: string;
}

function generateId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return (crypto as Crypto).randomUUID();
    }
    return Math.random().toString(36).slice(2);
}

/**
 * Uploads a WebP image blob for a note into the `note-images` storage bucket.
 * The bucket should be created and configured on Supabase separately.
 */
export async function uploadNoteImageWebP(
    noteId: string,
    blob: Blob
): Promise<UploadNoteImageResult> {
    if (!isSupabaseConfigured() || !supabase) {
        throw new Error('Supabase is not configured');
    }

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError) {
        throw userError;
    }
    const userId = userData.user?.id;
    if (!userId) {
        throw new Error('User is not authenticated');
    }

    const fileId = generateId();
    const filePath = `${userId}/${noteId}/${fileId}.webp`;

    const { error: uploadError } = await supabase.storage
        .from('note-images')
        .upload(filePath, blob, {
            cacheControl: '3600',
            upsert: false,
            contentType: 'image/webp'
        });

    if (uploadError) {
        throw uploadError;
    }

    const { data } = supabase.storage.from('note-images').getPublicUrl(filePath);

    return {
        publicUrl: data.publicUrl,
        path: filePath
    };
}

/**
 * Deletes a previously uploaded note image from the `note-images` bucket.
 * Fails silently (logs to console) if Supabase is not configured.
 */
export async function deleteNoteImage(path: string): Promise<void> {
    if (!isSupabaseConfigured() || !supabase) {
        return;
    }

    try {
        const { error } = await supabase.storage.from('note-images').remove([path]);
        if (error) {
            console.warn('[storage] Failed to delete note image', path, error);
        }
    } catch (err) {
        console.warn('[storage] Exception while deleting note image', path, err);
    }
}


