import Stream from 'mithril/stream';

export default function StoredStream<T>(key: string, initialValue?: T): Stream<T> {
  const stream = Stream<T>();

  // When the stream changes, save it to localStorage
  stream.map((t: T) => {
    localStorage.setItem(key, JSON.stringify(t));
  });

  // When localStorage changes, load it into the stream
  const onStorage = (ev: StorageEvent) => {
    if (ev.key !== key) { return; }
    stream(JSON.parse(localStorage.getItem(key)!));
  };
  window.addEventListener('storage', onStorage);

  // Try initializing from localStorage, using initialValue (if present) as a backup
  const maybeStored = localStorage.getItem(key);
  if (maybeStored !== null) {
    stream(JSON.parse(maybeStored));
  } else if (initialValue !== undefined) {
    stream(initialValue);
  }

  return stream;
}
