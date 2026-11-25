import { useEffect, useRef, useState } from 'react';
import { unzipSync } from 'fflate';

type Game = {
  id: number;
  slug: string;
  title: string;
  creator: string;
  entry_file: string;
  created_at: string;
};

function navigate(path: string) {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function usePath() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return path;
}

export default function App() {
  const path = usePath();

  const playMatch = path.match(/^\/play\/([^/]+)$/);

  return (
    <div>
      <header className="topbar">
        <div className="topbar-inner">
          <a
            href="/"
            className="brand"
            onClick={(e) => {
              e.preventDefault();
              navigate('/');
            }}
          >
            <span className="brand-mark" />
            <span>HTML Games</span>
          </a>

          {path !== '/publish' && (
            <a
              href="/publish"
              className="btn btn-red"
              onClick={(e) => {
                e.preventDefault();
                navigate('/publish');
              }}
            >
              + Publish Game
            </a>
          )}
        </div>
      </header>

      <main className="container">
        {path === '/publish' ? (
          <PublishPage />
        ) : playMatch ? (
          <PlayPage slug={decodeURIComponent(playMatch[1])} />
        ) : (
          <HomePage />
        )}
      </main>
    </div>
  );
}

function HomePage() {
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/games')
      .then((r) => r.json() as Promise<{ games?: Game[] }>)
      .then((data) => setGames(data.games ?? []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">All Games</h1>
        <span className="muted">
          {loading ? 'Loading...' : `${games.length} game${games.length === 1 ? '' : 's'}`}
        </span>
      </div>

      {!loading && games.length === 0 ? (
        <div className="empty-box">
          <p style={{ margin: '0 0 12px', fontWeight: 600 }}>No games published yet.</p>
          <p className="muted" style={{ margin: '0 0 18px' }}>
            Be the first to upload an HTML game.
          </p>
          <button className="btn btn-red" onClick={() => navigate('/publish')}>
            + Publish Game
          </button>
        </div>
      ) : (
        <div className="grid">
          {games.map((g) => (
            <div key={g.id} className="card">
              <div>
                <h2 className="card-title">{g.title}</h2>
                <div className="card-meta">by {g.creator}</div>
              </div>
              <a
                href={`/play/${g.slug}`}
                className="btn btn-red"
                onClick={(e) => {
                  e.preventDefault();
                  navigate(`/play/${g.slug}`);
                }}
              >
                Play
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PublishPage() {
  const [title, setTitle] = useState('');
  const [creator, setCreator] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function extractUploadFiles(file: File): Promise<{ path: string; blob: Blob }[]> {
    const lower = file.name.toLowerCase();
    if (lower.endsWith('.html') || lower.endsWith('.htm')) {
      return [{ path: 'index.html', blob: file }];
    }

    if (lower.endsWith('.zip')) {
      const buf = new Uint8Array(await file.arrayBuffer());
      const unzipped = unzipSync(buf);
      const rawEntries = Object.entries(unzipped).filter(
        ([name]) => !name.endsWith('/') && !name.startsWith('__MACOSX/')
      );

      if (rawEntries.length === 0) {
        throw new Error('The zip file is empty.');
      }

      // If all files share a single top-level folder (e.g. my-game/index.html), strip it
      const firstSegments = rawEntries.map(([name]) => name.split('/')[0]);
      const allShareTopDir =
        rawEntries.every(([name]) => name.includes('/')) &&
        firstSegments.every((seg) => seg === firstSegments[0]);

      const prefixLen = allShareTopDir ? firstSegments[0].length + 1 : 0;

      return rawEntries.map(([name, data]) => ({
        path: name.slice(prefixLen),
        blob: new Blob([new Uint8Array(data)]),
      }));
    }

    throw new Error('Please upload an .html file or a .zip archive.');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!title.trim()) {
      setError('Please enter a game title.');
      return;
    }
    if (!selectedFile) {
      setError('Please select an .html or .zip file.');
      return;
    }

    setSubmitting(true);
    try {
      const extracted = await extractUploadFiles(selectedFile);
      const formData = new FormData();
      formData.append('title', title.trim());
      formData.append('creator', creator.trim() || 'Anonymous');

      for (const item of extracted) {
        formData.append('files', item.blob, item.path);
        formData.append('paths', item.path);
      }

      const res = await fetch('/api/games', {
        method: 'POST',
        body: formData,
      });

      const data = (await res.json()) as { game?: Game; error?: string };
      if (!res.ok || !data.game) {
        throw new Error(data.error || 'Failed to publish game.');
      }

      navigate(`/play/${data.game.slug}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="form-card">
      <div className="page-header" style={{ marginBottom: 20 }}>
        <h1 className="page-title">Publish a Game</h1>
        <button className="btn btn-outline" onClick={() => navigate('/')}>
          Cancel
        </button>
      </div>

      {error && <div className="error-box">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="field">
          <label className="label" htmlFor="title">
            Game Title
          </label>
          <input
            id="title"
            className="input"
            type="text"
            placeholder="e.g. Space Dodge"
            maxLength={80}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="creator">
            Creator Name <span className="muted">(optional)</span>
          </label>
          <input
            id="creator"
            className="input"
            type="text"
            placeholder="Anonymous"
            maxLength={40}
            value={creator}
            onChange={(e) => setCreator(e.target.value)}
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="game-file">
            Game File (.html or .zip with index.html)
          </label>
          <label className="dropzone" style={{ display: 'block' }}>
            <input
              id="game-file"
              type="file"
              accept=".html,.htm,.zip"
              style={{ display: 'none' }}
              onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
            />
            {selectedFile ? (
              <span>
                <strong>{selectedFile.name}</strong>{' '}
                <span className="muted">
                  ({(selectedFile.size / 1024).toFixed(1)} KB)
                </span>
              </span>
            ) : (
              <span className="muted">Click to choose an .html or .zip file</span>
            )}
          </label>
        </div>

        <button
          type="submit"
          className="btn btn-red"
          style={{ width: '100%' }}
          disabled={submitting}
        >
          {submitting ? 'Publishing...' : 'Publish Game'}
        </button>
      </form>
    </div>
  );
}

function PlayPage({ slug }: { slug: string }) {
  const [game, setGame] = useState<Game | null>(null);
  const [notFound, setNotFound] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    fetch(`/api/games/${encodeURIComponent(slug)}`)
      .then((r) => {
        if (!r.ok) {
          setNotFound(true);
          return null;
        }
        return r.json() as Promise<{ game: Game }>;
      })
      .then((data) => {
        if (data?.game) setGame(data.game);
      });
  }, [slug]);

  function handleFullscreen() {
    frameRef.current?.requestFullscreen?.();
  }

  if (notFound) {
    return (
      <div className="empty-box">
        <p style={{ margin: '0 0 12px', fontWeight: 600 }}>Game not found.</p>
        <button className="btn btn-outline" onClick={() => navigate('/')}>
          ← Back to All Games
        </button>
      </div>
    );
  }

  if (!game) {
    return <p className="muted">Loading game...</p>;
  }

  return (
    <div>
      <div className="play-header">
        <div>
          <button
            className="btn btn-outline"
            style={{ marginRight: 12 }}
            onClick={() => navigate('/')}
          >
            ← Back
          </button>
          <span style={{ fontWeight: 700, fontSize: 18 }}>{game.title}</span>{' '}
          <span className="muted">by {game.creator}</span>
        </div>

        <button className="btn btn-red" onClick={handleFullscreen}>
          Fullscreen
        </button>
      </div>

      <div className="play-frame-wrap">
        <iframe
          ref={frameRef}
          className="play-frame"
          title={game.title}
          src={`/sandbox/${game.slug}/${game.entry_file}`}
          sandbox="allow-scripts allow-pointer-lock allow-modals"
        />
      </div>
    </div>
  );
}

