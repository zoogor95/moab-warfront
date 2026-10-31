import { useEffect, useRef, useState } from 'react';
import { CHAT_MAX_LENGTH, type ChatMessage } from '@warfront/shared/protocol';
import { EmblemIcon } from './Icons';

interface Props {
  messages: ChatMessage[];
  mySeat: number | null;
  onSend: (text: string) => Promise<string | null>;
}

/** Match chat: newest at the bottom; sending shows the server's refusal (such as the rate limit) inline. */
export function Chat({ messages, mySeat, onSend }: Props) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    const refused = await onSend(t);
    setError(refused);
    if (!refused) setText('');
  };

  return (
    <section className="panel chat" aria-label="Chat">
      <h2 className="eyebrow">Chat</h2>
      <ol className="chat-list" ref={listRef} aria-live="polite">
        {messages.length === 0 && <li className="muted">No messages yet.</li>}
        {messages.map((m, i) => (
          <li key={i}>
            {m.seat !== null && <EmblemIcon seat={m.seat} />} <strong>{m.seat === mySeat ? 'You' : m.name}</strong> <span>{m.text}</span>
          </li>
        ))}
      </ol>
      <form className="chat-form" onSubmit={(e) => (e.preventDefault(), void send())}>
        <label className="sr-only" htmlFor="chat-text">Message</label>
        <input id="chat-text" value={text} maxLength={CHAT_MAX_LENGTH} placeholder="Say something" autoComplete="off" onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="btn" disabled={!text.trim()}>Send</button>
      </form>
      {error && <p className="warn">{error}</p>}
    </section>
  );
}
