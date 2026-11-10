import { useState, useEffect, createContext, useContext } from 'react';
import { Routes, Route, Link, useNavigate, useParams, Navigate } from 'react-router-dom';
import { api, API } from './api.js';

const Auth = createContext();
const useAuth = () => useContext(Auth);

export default function App() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    if (!localStorage.getItem('token')) return;
    api('/api/login', { method: 'POST', body: {} }).catch(() => {});
    // trust local token; role-based rendering handles the rest
    const stored = localStorage.getItem('user');
    if (stored) setUser(JSON.parse(stored));
  }, []);

  function login(token, u) {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(u));
    setUser(u);
  }
  function logout() {
    localStorage.clear();
    setUser(null);
  }

  return (
    <Auth.Provider value={{ user, login, logout }}>
      <nav style={{ padding: 12, borderBottom: '1px solid #ddd', display: 'flex', gap: 12 }}>
        <Link to="/" style={{ fontWeight: 'bold' }}>🐾 Dewclaw</Link>
        <div style={{ flex: 1 }} />
        {user ? (
          <>
            {user.role === 'adopter' && <Link to="/applications">My applications</Link>}
            {user.role === 'shelter_admin' && <Link to="/dashboard">Dashboard</Link>}
            <span>{user.name}</span>
            <button onClick={logout}>Logout</button>
          </>
        ) : (
          <Link to="/login">Login</Link>
        )}
      </nav>
      <main style={{ maxWidth: 900, margin: '20px auto', padding: '0 12px' }}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/dogs/:id" element={<DogPage />} />
          <Route path="/applications" element={<MyApplications />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </Auth.Provider>
  );
}

// ---------- Home ----------
function Home() {
  const [dogs, setDogs] = useState([]);
  useEffect(() => { api('/api/dogs').then(d => setDogs(d.dogs)); }, []);

  return (
    <>
      <h1>Dogs looking for a home</h1>
      {dogs.map(d => (
        <Link key={d.id} to={`/dogs/${d.id}`}
          style={{ display: 'block', padding: 12, border: '1px solid #ddd', marginBottom: 8, textDecoration: 'none', color: 'inherit' }}>
          <strong>{d.name}</strong> — {d.breed || 'Indie'} · <span>{d.status}</span>
        </Link>
      ))}
      {dogs.length === 0 && <p>No dogs yet.</p>}
    </>
  );
}

// ---------- Login ----------
function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('admin@demo.test');
  const [password, setPassword] = useState('demo1234');
  const [error, setError] = useState('');
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [role, setRole] = useState('adopter');

  async function submit(e) {
    e.preventDefault();
    setError('');
    try {
      if (mode === 'login') {
        const { token, user } = await api('/api/login', { method: 'POST', body: { email, password } });
        login(token, user);
      } else {
        const { token, user } = await api('/api/register', { method: 'POST', body: { name, email, password, role } });
        login(token, user);
      }
      nav('/');
    } catch (e) { setError(e.message); }
  }

  return (
    <form onSubmit={submit} style={{ maxWidth: 320, margin: '40px auto' }}>
      <h1>{mode === 'login' ? 'Login' : 'Register'}</h1>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {mode === 'register' && <input placeholder="Name" value={name} onChange={e => setName(e.target.value)} style={{ width: '100%', marginBottom: 8 }} />}
      <input placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} style={{ width: '100%', marginBottom: 8 }} />
      <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} style={{ width: '100%', marginBottom: 8 }} />
      {mode === 'register' && (
        <select value={role} onChange={e => setRole(e.target.value)} style={{ width: '100%', marginBottom: 8 }}>
          <option value="adopter">Adopter</option>
          <option value="shelter_admin">Shelter admin</option>
        </select>
      )}
      <button type="submit" style={{ width: '100%' }}>{mode === 'login' ? 'Login' : 'Register'}</button>
      <p><a href="#" onClick={e => { e.preventDefault(); setMode(mode === 'login' ? 'register' : 'login'); }}>
        {mode === 'login' ? 'Create an account' : 'Have an account? Login'}
      </a></p>
    </form>
  );
}

// ---------- DogPage ----------
function DogPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState('');

  async function load() { setData(await api(`/api/dogs/${id}`)); }
  useEffect(() => { load(); }, [id]);

  async function apply() {
    try {
      await api(`/api/dogs/${id}/apply`, { method: 'POST', body: { message: msg } });
      alert('Application submitted');
      load();
    } catch (e) { alert(e.message); }
  }

  async function setStatus(status) {
    try {
      await api(`/api/dogs/${id}/status`, { method: 'POST', body: { status } });
      load();
    } catch (e) { alert(e.message); }
  }

  if (!data) return <p>Loading…</p>;
  const { dog, activity } = data;

  return (
    <>
      <h1>{dog.name} <small style={{ fontSize: 14 }}>({dog.status})</small></h1>
      {dog.photo && <img src={API + dog.photo} alt="" style={{ maxWidth: 240, borderRadius: 8 }} />}
      <p>{dog.breed} · {dog.age_months ? `${Math.floor(dog.age_months / 12)}y` : '?'} · {dog.size}</p>
      <p>{dog.temperament}</p>
      {dog.reserved_until && <p><em>Reserved until {dog.reserved_until.slice(0, 10)}</em></p>}

      {user?.role === 'adopter' && dog.status === 'available' && (
        <div style={{ marginTop: 16 }}>
          <textarea placeholder="Why you?" value={msg} onChange={e => setMsg(e.target.value)} style={{ width: '100%', marginBottom: 8 }} />
          <button onClick={apply}>Apply to adopt</button>
        </div>
      )}

      {user?.role === 'shelter_admin' && (
        <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
          {dog.status !== 'reserved' && <button onClick={() => setStatus('reserved')}>Reserve</button>}
          {dog.status !== 'available' && <button onClick={() => setStatus('available')}>Available again</button>}
          {dog.status !== 'adopted' && <button onClick={() => setStatus('adopted')}>Mark adopted</button>}
        </div>
      )}

      <h3 style={{ marginTop: 24 }}>History</h3>
      <ul>
        {activity.map(a => <li key={a.id}>{new Date(a.created_at).toLocaleString()} — {a.text}</li>)}
      </ul>
    </>
  );
}

// ---------- MyApplications ----------
function MyApplications() {
  const [apps, setApps] = useState([]);
  useEffect(() => { api('/api/applications/mine').then(d => setApps(d.applications)); }, []);
  return (
    <>
      <h1>My applications</h1>
      {apps.map(a => (
        <div key={a.id} style={{ padding: 12, border: '1px solid #ddd', marginBottom: 8 }}>
          <strong>{a.dog_name}</strong> — dog is {a.dog_status}
        </div>
      ))}
      {apps.length === 0 && <p>None yet.</p>}
    </>
  );
}

// ---------- Dashboard ----------
function Dashboard() {
  const { user } = useAuth();
  const [apps, setApps] = useState([]);
  const [dogs, setDogs] = useState([]);
  const [form, setForm] = useState({ name: '', breed: '' });

  async function load() {
    setApps((await api('/api/applications')).applications);
    setDogs((await api('/api/dogs')).dogs);
  }
  useEffect(() => { load(); }, []);

  async function addDog(e) {
    e.preventDefault();
    await api('/api/dogs', { method: 'POST', body: form });
    setForm({ name: '', breed: '' });
    load();
  }

  if (user?.role !== 'shelter_admin') return <p>Shelter admins only.</p>;

  return (
    <>
      <h1>Dashboard</h1>
      <h3>Add a dog</h3>
      <form onSubmit={addDog} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input placeholder="Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
        <input placeholder="Breed" value={form.breed} onChange={e => setForm({ ...form, breed: e.target.value })} />
        <button>Add</button>
      </form>

      <h3>All dogs ({dogs.length})</h3>
      {dogs.map(d => (
        <div key={d.id} style={{ padding: 8, borderBottom: '1px solid #eee' }}>
          <Link to={`/dogs/${d.id}`}>{d.name}</Link> — {d.status}
        </div>
      ))}

      <h3 style={{ marginTop: 24 }}>Recent applications ({apps.length})</h3>
      {apps.map(a => (
        <div key={a.id} style={{ padding: 8, borderBottom: '1px solid #eee' }}>
          <strong>{a.user_name}</strong> applied for <Link to={`/dogs/${a.dog_id}`}>{a.dog_name}</Link>
          {a.message && <> — “{a.message}”</>}
        </div>
      ))}
    </>
  );
}
