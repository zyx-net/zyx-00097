import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import LevelSelectPage from '@/pages/LevelSelectPage';
import GameBoardPage from '@/pages/GameBoardPage';
import ResultPage from '@/pages/ResultPage';
import HistoryPage from '@/pages/HistoryPage';
import NotFoundPage from '@/pages/NotFoundPage';

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<LevelSelectPage />} />
        <Route path="/game/:levelId" element={<GameBoardPage />} />
        <Route path="/result/:sessionId" element={<ResultPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Router>
  );
}
