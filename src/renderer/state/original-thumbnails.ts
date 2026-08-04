import { useEffect, useRef, useState } from "react";
import { api } from "../ipc/client";

// The original-thumbnail cache, owned in one place. app.tsx previously spread this
// across four structures kept in sync by hand at every mutation site — the dataUrl
// map plus three refs (current ids, loaded ids, in-flight requests) — and forgetting
// one at a new site was the standing failure mode. The hook reconciles itself
// against the live originals list instead: callers never clean up, because removing
// an original simply changes the list this effect prunes against.
export function useOriginalThumbnails(
  originals: readonly { id: string }[] | undefined
): Record<string, string> {
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  // loaded — a thumbnail (or its terminal failure placeholder) landed in the map;
  // inflight — a request is out, so the reconcile pass must not re-request;
  // currentIds — the latest originals list, which a settling response checks so a
  // thumbnail for a since-removed original is dropped instead of re-cached.
  const loadedRef = useRef(new Set<string>());
  const inflightRef = useRef(new Set<string>());
  const currentIdsRef = useRef(new Set<string>());

  useEffect(() => {
    const list = originals ?? [];
    const currentIds = new Set(list.map((original) => original.id));
    currentIdsRef.current = currentIds;
    loadedRef.current.forEach((id) => {
      if (!currentIds.has(id)) loadedRef.current.delete(id);
    });
    inflightRef.current.forEach((id) => {
      if (!currentIds.has(id)) inflightRef.current.delete(id);
    });
    setThumbnails((current) => {
      const next = Object.fromEntries(Object.entries(current).filter(([id]) => currentIds.has(id)));
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });

    const missing = list.filter((original) =>
      !loadedRef.current.has(original.id) && !inflightRef.current.has(original.id)
    );
    if (missing.length === 0) return;

    for (const original of missing) {
      inflightRef.current.add(original.id);
      void api.preview.originalThumbnail(original.id)
        .then((thumbnail) => {
          inflightRef.current.delete(thumbnail.originalId);
          if (!currentIdsRef.current.has(thumbnail.originalId)) return;
          loadedRef.current.add(thumbnail.originalId);
          setThumbnails((current) => ({ ...current, [thumbnail.originalId]: thumbnail.dataUrl }));
        })
        .catch((thumbnailError) => {
          console.warn("Failed to load original thumbnail", original.id, thumbnailError);
          inflightRef.current.delete(original.id);
          if (!currentIdsRef.current.has(original.id)) return;
          loadedRef.current.add(original.id);
          setThumbnails((current) => ({ ...current, [original.id]: "" }));
        });
    }
  }, [originals]);

  return thumbnails;
}
