import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Home, AlertTriangle } from 'lucide-react';

export default function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="card p-8 max-w-md w-full text-center">
        <div className="w-16 h-16 rounded-2xl bg-amber-100 text-amber-600 flex items-center justify-center mx-auto mb-4">
          <AlertTriangle size={28} />
        </div>
        <h1 className="font-title text-3xl text-slate-900 mb-1">404</h1>
        <p className="text-slate-500 mb-6">请求的页面不存在或链接已失效</p>
        <button onClick={() => navigate('/')} className="btn-primary">
          <Home size={16} /> 返回首页
        </button>
      </div>
    </div>
  );
}
