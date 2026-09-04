import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Header } from './components/Header';
import { api } from './lib/api';
import type { Persona } from './lib/types';
import { ChatPage } from './pages/Chat';
import { DeskPage } from './pages/Desk';
import { EvalPage } from './pages/Eval';
import './styles/app.css';

const PERSONA_KEY = 'westline.persona';

function App() {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [persona, setPersonaState] = useState<Persona | null>(null);
  useEffect(() => {
    api.personas().then((list) => {
      setPersonas(list);
      const saved = localStorage.getItem(PERSONA_KEY);
      setPersonaState(list.find((p) => p.person_id === saved) ?? null);
    }).catch(() => setPersonas([]));
  }, []);
  const setPersona = (p: Persona | null) => {
    setPersonaState(p);
    if (p) localStorage.setItem(PERSONA_KEY, p.person_id); else localStorage.removeItem(PERSONA_KEY);
  };
  return (
    <BrowserRouter>
      <div className="flex h-screen flex-col overflow-hidden">
        <Header personas={personas} persona={persona} onPersona={setPersona} />
        <Routes>
          <Route path="/" element={<ChatPage persona={persona} personas={personas} onPersona={setPersona} />} />
          <Route path="/desk" element={<DeskPage />} />
          <Route path="/eval" element={<EvalPage />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
