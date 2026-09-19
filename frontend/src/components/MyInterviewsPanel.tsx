import React, { useMemo, useState } from 'react';
import { InterviewRoom, getRoomStatusConfig, BATCHABLE_ROOM_STATUSES, BATCH_ROOM_ACTION_LABELS, isBatchTransitionAllowed, BatchRoomAction, BatchRoomStatusResponse } from '../types';
import { batchUpdateRoomStatuses } from '../services/interviewRoomService';
import { useInterviewStore, LastBatchResult, BatchRoomResultItem } from '../store/interview';
import { useToastStore } from '../store/toast';

type StatusFilter = 'ALL' | InterviewRoom['status'];

interface MyInterviewsPanelProps {
  onCreateRoom: () => void;
  onEnterRoom: (room: InterviewRoom) => void;
}

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'ALL', label: '全部' },
  { value: 'WAITING', label: '等待中' },
  { value: 'ACTIVE', label: '进行中' },
  { value: 'COMPLETED', label: '已结束' },
  { value: 'CANCELLED', label: '已取消' },
];

const ACTION_STYLES: Record<BatchRoomAction, { background: string; hover: string }> = {
  COMPLETED: { background: '#2196f3', hover: '#1976d2' },
  CANCELLED: { background: '#f44336', hover: '#d32f2f' },
  WAITING: { background: '#ff9800', hover: '#f57c00' },
};

export const MyInterviewsPanel: React.FC<MyInterviewsPanelProps> = ({ onCreateRoom, onEnterRoom }) => {
  const {
    myRooms,
    lastBatchResult,
    applyRoomStatusUpdates,
    setLastBatchResult,
    removeBatchResultItem,
  } = useInterviewStore();
  const { success, error } = useToastStore();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pendingAction, setPendingAction] = useState<BatchRoomAction | null>(null);
  const [retryingRoomId, setRetryingRoomId] = useState<string | null>(null);
  const [resultCollapsed, setResultCollapsed] = useState(false);

  // 筛选只派生视图，绝不回写 myRooms：筛选为空时整页数据仍保留
  const filteredRooms = useMemo(
    () => (statusFilter === 'ALL' ? myRooms : myRooms.filter((r) => r.status === statusFilter)),
    [myRooms, statusFilter]
  );

  const roomById = useMemo(() => new Map(myRooms.map((r) => [r.id, r])), [myRooms]);

  // 仅等待中 / 已结束的房间可被勾选（进行中、已取消不参与批量管理）
  const selectableIdsInView = useMemo(
    () => filteredRooms.filter((r) => BATCHABLE_ROOM_STATUSES.includes(r.status)).map((r) => r.id),
    [filteredRooms]
  );

  const selectedRooms = useMemo(
    () => Array.from(selectedIds).map((id) => roomById.get(id)).filter((r): r is InterviewRoom => !!r),
    [selectedIds, roomById]
  );

  const eligibleCountByAction = useMemo(() => {
    const counts: Record<BatchRoomAction, number> = { COMPLETED: 0, CANCELLED: 0, WAITING: 0 };
    for (const room of selectedRooms) {
      (Object.keys(counts) as BatchRoomAction[]).forEach((action) => {
        if (isBatchTransitionAllowed(room.status, action)) {
          counts[action] += 1;
        }
      });
    }
    return counts;
  }, [selectedRooms]);

  const allInViewSelected = selectableIdsInView.length > 0
    && selectableIdsInView.every((id) => selectedIds.has(id));

  const toggleSelect = (roomId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(roomId)) {
        next.delete(roomId);
      } else {
        next.add(roomId);
      }
      return next;
    });
  };

  const toggleSelectAllInView = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allInViewSelected) {
        selectableIdsInView.forEach((id) => next.delete(id));
      } else {
        selectableIdsInView.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const buildResultItems = (
    response: BatchRoomStatusResponse,
    timestamp: string
  ): BatchRoomResultItem[] =>
    response.results.map((r) => {
      const snapshot = r.room ?? roomById.get(r.roomId) ?? null;
      return {
        roomId: r.roomId,
        roomTitle: snapshot?.title ?? '未知房间',
        roomCode: snapshot?.roomCode ?? '-',
        targetStatus: r.targetStatus,
        success: r.success,
        message: r.message,
        timestamp,
      };
    });

  const runBatch = async (action: BatchRoomAction, explicitItems?: { roomId: string; targetStatus: BatchRoomAction }[]) => {
    const items = explicitItems
      ?? selectedRooms
        .filter((room) => isBatchTransitionAllowed(room.status, action))
        .map((room) => ({ roomId: room.id, targetStatus: action }));

    if (items.length === 0) return;

    setPendingAction(action);
    const timestamp = new Date().toISOString();
    try {
      const response = await batchUpdateRoomStatuses(items);

      // 已成功项合并进列表；未生效项保持原状态不动
      const updatedRooms = response.results
        .filter((r) => r.success && r.room)
        .map((r) => r.room as InterviewRoom);
      if (updatedRooms.length > 0) {
        applyRoomStatusUpdates(updatedRooms);
      }

      const resultItems = buildResultItems(response, timestamp);
      const batchResult: LastBatchResult = {
        id: `batch-${Date.now()}`,
        action: response.action,
        total: response.total,
        successCount: response.successCount,
        failedCount: response.failedCount,
        items: resultItems,
        timestamp,
      };
      setLastBatchResult(batchResult);
      setResultCollapsed(false);

      if (response.failedCount === 0) {
        success(`批量「${BATCH_ROOM_ACTION_LABELS[action]}」完成，共 ${response.successCount} 个房间生效`);
      } else {
        error(`部分条目未生效：成功 ${response.successCount} 个，失败 ${response.failedCount} 个，可在结果列表中单独重试`);
      }

      if (!explicitItems) {
        // 批量执行后：成功项取消勾选（已离开可执行状态），失败项保留勾选以便再次操作
        const failedIds = new Set(response.results.filter((r) => !r.success).map((r) => r.roomId));
        setSelectedIds((prev) => new Set(Array.from(prev).filter((id) => failedIds.has(id))));
      }
    } catch (err) {
      console.error('Batch update failed:', err);
      error('批量操作失败，请稍后重试');
    } finally {
      setPendingAction(null);
    }
  };

  const handleBatchAction = (action: BatchRoomAction) => {
    if (eligibleCountByAction[action] === 0 || pendingAction) return;
    void runBatch(action);
  };

  const handleRetryItem = async (item: BatchRoomResultItem) => {
    if (retryingRoomId || pendingAction) return;
    setRetryingRoomId(item.roomId);
    const timestamp = new Date().toISOString();
    try {
      const response = await batchUpdateRoomStatuses([{ roomId: item.roomId, targetStatus: item.targetStatus }]);
      const result = response.results[0];

      if (result?.success && result.room) {
        applyRoomStatusUpdates([result.room]);
      }

      // 用重试结果替换该条目，逐项结果始终保留在面板中
      const current = useInterviewStore.getState().lastBatchResult;
      if (current) {
        const snapshot = result?.room ?? roomById.get(item.roomId) ?? null;
        const retriedItem: BatchRoomResultItem = {
          ...item,
          success: !!result?.success,
          message: result ? `${result.message}（重试）` : '重试失败',
          roomTitle: snapshot?.title ?? item.roomTitle,
          roomCode: snapshot?.roomCode ?? item.roomCode,
          timestamp,
        };
        const items = current.items.map((it) => (it.roomId === item.roomId ? retriedItem : it));
        const successCount = items.filter((it) => it.success).length;
        setLastBatchResult({
          ...current,
          items,
          total: items.length,
          successCount,
          failedCount: items.length - successCount,
        });
        if (result?.success) {
          success(`房间「${retriedItem.roomTitle}」已${BATCH_ROOM_ACTION_LABELS[item.targetStatus]}`);
          setSelectedIds((prev) => {
            const next = new Set(prev);
            next.delete(item.roomId);
            return next;
          });
        } else {
          error(`房间「${retriedItem.roomTitle}」仍未生效：${retriedItem.message}`);
        }
      }
    } catch (err) {
      console.error('Retry item failed:', err);
      error('重试失败，请稍后重试');
    } finally {
      setRetryingRoomId(null);
    }
  };

  const handleClearResult = () => {
    setLastBatchResult(null);
  };

  const handleDismissItem = (roomId: string) => {
    removeBatchResultItem(roomId);
  };

  const hasSelection = selectedIds.size > 0;

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '32px 24px' }}>
      <h1 style={{ color: '#fff', fontSize: '28px', margin: '0 0 8px 0' }}>我的面试</h1>
      <p style={{ color: '#888', margin: '0 0 24px 0' }}>管理您创建的所有面试房间，可多选等待中或已结束的房间批量处理</p>

      {/* 状态筛选：仅改变展示，不清空任何数据 */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
        {STATUS_FILTERS.map((filter) => {
          const active = statusFilter === filter.value;
          return (
            <button
              key={filter.value}
              onClick={() => setStatusFilter(filter.value)}
              style={{
                padding: '6px 16px',
                borderRadius: '16px',
                border: `1px solid ${active ? '#667eea' : '#444'}`,
                background: active ? 'rgba(102, 126, 234, 0.15)' : 'transparent',
                color: active ? '#8ea0f5' : '#aaa',
                fontSize: '13px',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}>
              {filter.label}
            </button>
          );
        })}
      </div>

      {/* 最近一次批量操作的逐项结果（跨打开列表持久保留） */}
      {lastBatchResult && (
        <BatchResultPanel
          result={lastBatchResult}
          collapsed={resultCollapsed}
          onToggleCollapse={() => setResultCollapsed((v) => !v)}
          onClear={handleClearResult}
          onRetry={handleRetryItem}
          onDismissItem={handleDismissItem}
          retryingRoomId={retryingRoomId}
        />
      )}

      {/* 批量操作工具栏 */}
      {hasSelection && (
        <div style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: '#252525',
          border: '1px solid #444',
          borderRadius: '10px',
          padding: '12px 16px',
          marginBottom: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          flexWrap: 'wrap',
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        }}>
          <span style={{ color: '#fff', fontSize: '14px', fontWeight: 500 }}>
            已选 {selectedIds.size} 个房间
          </span>
          <div style={{ display: 'flex', gap: '8px', flex: 1, flexWrap: 'wrap' }}>
            {(Object.keys(BATCH_ROOM_ACTION_LABELS) as BatchRoomAction[]).map((action) => {
              const count = eligibleCountByAction[action];
              const disabled = count === 0 || !!pendingAction;
              return (
                <button
                  key={action}
                  onClick={() => handleBatchAction(action)}
                  disabled={disabled}
                  title={count === 0 ? '所选房间中没有可执行该操作的条目' : ''}
                  style={{
                    padding: '8px 16px',
                    background: disabled ? '#555' : ACTION_STYLES[action].background,
                    color: '#fff',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    fontSize: '13px',
                    fontWeight: 500,
                    opacity: pendingAction === action ? 0.7 : 1,
                  }}>
                  {pendingAction === action ? '处理中...' : `${BATCH_ROOM_ACTION_LABELS[action]} (${count})`}
                </button>
              );
            })}
          </div>
          <button
            onClick={clearSelection}
            style={{
              padding: '8px 14px',
              background: 'transparent',
              color: '#aaa',
              border: '1px solid #555',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '13px',
            }}>
            取消选择
          </button>
        </div>
      )}

      {myRooms.length === 0 ? (
        <div style={{
          background: '#1e1e1e',
          borderRadius: '12px',
          padding: '64px 24px',
          textAlign: 'center',
          border: '1px dashed #333',
        }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>📋</div>
          <h3 style={{ color: '#fff', margin: '0 0 8px 0' }}>暂无面试房间</h3>
          <p style={{ color: '#888', margin: '0 0 24px 0' }}>点击右上角按钮创建您的第一个面试房间</p>
          <button
            onClick={onCreateRoom}
            style={{
              padding: '12px 32px',
              background: '#4caf50',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 500,
            }}>
            创建面试房间
          </button>
        </div>
      ) : filteredRooms.length === 0 ? (
        // 筛选为空：保留 myRooms 全量数据与批量结果，只提示当前筛选无匹配
        <div style={{
          background: '#1e1e1e',
          borderRadius: '12px',
          padding: '48px 24px',
          textAlign: 'center',
          border: '1px dashed #333',
        }}>
          <div style={{ fontSize: '36px', marginBottom: '12px' }}>🔍</div>
          <h3 style={{ color: '#fff', margin: '0 0 8px 0' }}>当前筛选下没有房间</h3>
          <p style={{ color: '#888', margin: '0 0 20px 0' }}>
            「{STATUS_FILTERS.find((f) => f.value === statusFilter)?.label}」状态下暂无房间，其它状态的房间与处理结果均已保留
          </p>
          <button
            onClick={() => setStatusFilter('ALL')}
            style={{
              padding: '10px 24px',
              background: 'transparent',
              color: '#8ea0f5',
              border: '1px solid #667eea',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px',
            }}>
            查看全部房间
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '12px' }}>
          <label style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            color: '#888',
            fontSize: '13px',
            padding: '0 4px',
            cursor: selectableIdsInView.length > 0 ? 'pointer' : 'default',
          }}>
            <input
              type="checkbox"
              checked={allInViewSelected}
              disabled={selectableIdsInView.length === 0}
              onChange={toggleSelectAllInView}
              style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: '#667eea' }}
            />
            全选当前列表中可批量管理的房间
          </label>

          {filteredRooms.map((room) => (
            <RoomCard
              key={room.id}
              room={room}
              selected={selectedIds.has(room.id)}
              onToggleSelect={() => toggleSelect(room.id)}
              onEnter={() => onEnterRoom(room)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

interface RoomCardProps {
  room: InterviewRoom;
  selected: boolean;
  onToggleSelect: () => void;
  onEnter: () => void;
}

const RoomCard: React.FC<RoomCardProps> = ({ room, selected, onToggleSelect, onEnter }) => {
  const selectable = BATCHABLE_ROOM_STATUSES.includes(room.status);
  const statusColor = getRoomStatusConfig(room.status).color;
  const statusLabel = getRoomStatusConfig(room.status).label;

  return (
    <div
      onClick={onEnter}
      style={{
        background: '#1e1e1e',
        borderRadius: '12px',
        padding: '20px 24px',
        border: `1px solid ${selected ? '#667eea' : '#333'}`,
        boxShadow: selected ? '0 0 0 1px #667eea inset' : 'none',
        cursor: 'pointer',
        transition: 'all 0.2s',
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
      }}
      onMouseEnter={(e) => {
        if (!selected) e.currentTarget.style.borderColor = '#4caf50';
        e.currentTarget.style.transform = 'translateX(4px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = selected ? '#667eea' : '#333';
        e.currentTarget.style.transform = 'translateX(0)';
      }}>
      {selectable ? (
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          onClick={(e) => e.stopPropagation()}
          title="选择该房间进行批量操作"
          style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#667eea', flexShrink: 0 }}
        />
      ) : (
        <span
          title={room.status === 'ACTIVE' ? '进行中的房间不参与批量管理' : '已取消的房间不参与批量管理'}
          style={{
            width: '18px',
            height: '18px',
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#555',
            fontSize: '14px',
          }}>
          🔒
        </span>
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
          <div>
            <h3 style={{ color: '#fff', margin: '0 0 4px 0', fontSize: '18px' }}>{room.title}</h3>
            <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
              <span style={{ color: '#888', fontSize: '13px' }}>
                房间码: <span style={{ color: '#4caf50', fontFamily: 'monospace', fontWeight: 'bold' }}>{room.roomCode}</span>
              </span>
              <span style={{
                padding: '4px 12px',
                borderRadius: '12px',
                fontSize: '11px',
                fontWeight: 500,
                background: statusColor + '20',
                color: statusColor,
              }}>
                {statusLabel}
              </span>
            </div>
          </div>
          <span style={{ color: '#4caf50', fontSize: '20px' }}>→</span>
        </div>
        <div style={{ color: '#666', fontSize: '12px' }}>
          创建于 {new Date(room.createdAt).toLocaleString('zh-CN')}
        </div>
      </div>
    </div>
  );
};

interface BatchResultPanelProps {
  result: LastBatchResult;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onClear: () => void;
  onRetry: (item: BatchRoomResultItem) => void;
  onDismissItem: (roomId: string) => void;
  retryingRoomId: string | null;
}

const BatchResultPanel: React.FC<BatchResultPanelProps> = ({
  result,
  collapsed,
  onToggleCollapse,
  onClear,
  onRetry,
  onDismissItem,
  retryingRoomId,
}) => {
  const actionLabel = BATCH_ROOM_ACTION_LABELS[result.action];
  const allSucceeded = result.failedCount === 0;

  return (
    <div style={{
      background: '#1e1e1e',
      border: `1px solid ${allSucceeded ? 'rgba(76,175,80,0.5)' : 'rgba(244,67,54,0.5)'}`,
      borderRadius: '10px',
      marginBottom: '16px',
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '12px 16px',
        background: allSucceeded ? 'rgba(76,175,80,0.08)' : 'rgba(244,67,54,0.08)',
      }}>
        <span style={{ fontSize: '18px' }}>{allSucceeded ? '✅' : '⚠️'}</span>
        <div style={{ flex: 1 }}>
          <span style={{ color: '#fff', fontSize: '14px', fontWeight: 600 }}>
            批量「{actionLabel}」结果
          </span>
          <span style={{ color: '#888', fontSize: '12px', marginLeft: '12px' }}>
            共 {result.total} 项 · <span style={{ color: '#4caf50' }}>成功 {result.successCount}</span>
            {result.failedCount > 0 && <span style={{ color: '#f44336', marginLeft: '8px' }}>未生效 {result.failedCount}</span>}
          </span>
        </div>
        <button
          onClick={onToggleCollapse}
          style={{ background: 'transparent', border: 'none', color: '#888', cursor: 'pointer', fontSize: '13px' }}>
          {collapsed ? '展开明细' : '收起'}
        </button>
        <button
          onClick={onClear}
          title="清除结果记录"
          style={{ background: 'transparent', border: 'none', color: '#888', cursor: 'pointer', fontSize: '16px' }}>
          ×
        </button>
      </div>

      {!collapsed && (
        <div style={{ maxHeight: '260px', overflowY: 'auto' }}>
          {result.items.map((item) => {
            const itemStatusColor = getRoomStatusConfig(item.targetStatus).color;
            const retrying = retryingRoomId === item.roomId;
            return (
              <div
                key={item.roomId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '10px 16px',
                  borderTop: '1px solid #2a2a2a',
                }}>
                <span style={{ fontSize: '16px', flexShrink: 0 }}>{item.success ? '✓' : '✕'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <span style={{ color: '#fff', fontSize: '13px', fontWeight: 500 }}>{item.roomTitle}</span>
                    <span style={{ color: '#777', fontSize: '11px', fontFamily: 'monospace' }}>{item.roomCode}</span>
                    <span style={{
                      fontSize: '11px',
                      padding: '2px 8px',
                      borderRadius: '10px',
                      background: itemStatusColor + '20',
                      color: itemStatusColor,
                    }}>
                      → {getRoomStatusConfig(item.targetStatus).label}
                    </span>
                  </div>
                  <div style={{ color: item.success ? '#666' : '#e57373', fontSize: '12px', marginTop: '2px' }}>
                    {item.success ? '已生效' : item.message}
                  </div>
                </div>
                {!item.success && (
                  <button
                    onClick={() => onRetry(item)}
                    disabled={!!retryingRoomId}
                    style={{
                      padding: '6px 14px',
                      background: retrying ? '#555' : '#ff9800',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: retrying ? 'wait' : 'pointer',
                      fontSize: '12px',
                      fontWeight: 500,
                      flexShrink: 0,
                    }}>
                    {retrying ? '执行中...' : '单独再执行'}
                  </button>
                )}
                <button
                  onClick={() => onDismissItem(item.roomId)}
                  title="移除该条记录"
                  style={{ background: 'transparent', border: 'none', color: '#666', cursor: 'pointer', fontSize: '14px', flexShrink: 0 }}>
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
