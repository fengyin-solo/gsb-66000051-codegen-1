import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate, Link, useLocation } from 'react-router-dom';
import { JoinRoomPage } from './components/JoinRoomPage';
import { InterviewerRoomView } from './components/InterviewerRoomView';
import CandidateRoomView from './components/CandidateRoomView';
import { ProblemBankPage } from './components/ProblemBankPage';
import { MyInterviewsPage } from './components/MyInterviewsPage';
import { useInterviewStore } from './store/interview';
import { InterviewRoom, User } from './types';
import { CreateRoomModal } from './components/CreateRoomModal';
import { getRoomsByInterviewer } from './services/interviewRoomService';
import { ToastContainer } from './components/Toast';
import { useToastStore } from './store/toast';

const mockInterviewer: User = {
  id: 'interviewer-001',
  name: '张面试官',
  email: 'interviewer@example.com',
  role: 'INTERVIEWER',
  createdAt: new Date().toISOString(),
};

const InterviewerHomePage: React.FC = () => {
  const { currentUser, setCurrentUser, setCurrentRoom } = useInterviewStore();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    setCurrentUser(mockInterviewer);
  }, [setCurrentUser]);

  useEffect(() => {
    if (currentUser) {
      loadMyRooms();
    }
  }, [currentUser]);

  const loadMyRooms = async () => {
    if (!currentUser) return;
    try {
      const rooms = await getRoomsByInterviewer(currentUser.id);
      useInterviewStore.getState().setMyRooms(rooms);
    } catch (error) {
      // 加载失败时保留当前列表数据，不用空结果清空整页
      console.error('Failed to load rooms:', error);
    }
  };

  const handleCreateRoomSuccess = (room: InterviewRoom) => {
    setCurrentRoom(room);
    navigate(`/room/${room.id}/interviewer`);
  };

  const activeTab = location.pathname === '/problem-bank' ? 'bank' : 'interviews';

  const tabButtonStyle = (active: boolean) => ({
    padding: '12px 24px',
    background: 'transparent',
    border: 'none',
    color: active ? '#fff' : '#888',
    cursor: 'pointer',
    fontSize: '15px',
    fontWeight: active ? 500 : 400,
    borderBottom: active ? '2px solid #667eea' : '2px solid transparent',
    transition: 'all 0.2s',
  });

  return (
    <div style={{ minHeight: '100vh', background: '#0d0d0d', fontFamily: 'sans-serif' }}>
      <div style={{
        background: '#1e1e1e',
        borderBottom: '1px solid #333',
        padding: '16px 24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '40px', height: '40px', borderRadius: '50%',
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontWeight: 'bold', fontSize: '16px',
          }}>
            {currentUser?.name?.charAt(0) || 'U'}
          </div>
          <div>
            <div style={{ color: '#fff', fontWeight: 500 }}>{currentUser?.name}</div>
            <div style={{ color: '#888', fontSize: '12px' }}>{currentUser?.role}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          {activeTab === 'bank' ? null : (
            <button
              onClick={() => setIsCreateModalOpen(true)}
              style={{
                padding: '10px 24px',
                background: '#4caf50',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: 500,
              }}>
              + 创建面试房间
            </button>
          )}
        </div>
      </div>

      <div style={{ background: '#1e1e1e', borderBottom: '1px solid #333' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '0 24px', display: 'flex', gap: '8px' }}>
          <Link
            to="/"
            style={{ textDecoration: 'none' }}
          >
            <button style={tabButtonStyle(activeTab === 'interviews')}>
              📋 我的面试
            </button>
          </Link>
          <Link
            to="/problem-bank"
            style={{ textDecoration: 'none' }}
          >
            <button style={tabButtonStyle(activeTab === 'bank')}>
              📝 题库管理
            </button>
          </Link>
        </div>
      </div>

      {activeTab === 'interviews' && (
        <MyInterviewsPage onCreateRoom={() => setIsCreateModalOpen(true)} />
      )}

      {activeTab === 'bank' && (
        <ProblemBankPage />
      )}

      <CreateRoomModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={handleCreateRoomSuccess}
      />
    </div>
  );
};

const InterviewerRoomPage: React.FC = () => {
  return <InterviewerRoomView />;
};

const App: React.FC = () => {
  const { toasts, removeToast } = useToastStore();
  return (
    <>
      <Routes>
        <Route path="/" element={<InterviewerHomePage />} />
        <Route path="/problem-bank" element={<InterviewerHomePage />} />
        <Route path="/join" element={<JoinRoomPage />} />
        <Route path="/room/:roomId/interviewer" element={<InterviewerRoomPage />} />
        <Route path="/room/:roomId/candidate" element={<CandidateRoomView />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </>
  );
};

export default App;
