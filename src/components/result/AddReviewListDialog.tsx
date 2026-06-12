import React from 'react';
import { X, Flag, User, MessageSquare, Clock, Trash2, CheckCircle } from 'lucide-react';
import { useReviewListStore } from '../../store/reviewListStore';
import { classNames } from '../../utils/uuid';
import type { ReviewPriority, ReviewStatus } from '../../types';
import { REVIEW_PRIORITY_LABEL, REVIEW_PRIORITY_COLOR } from '../../types';

export function AddReviewListDialog() {
  const { addDialogOpen, addingRecordId, closeAddDialog, saveAdd, getItem, remove, update } = useReviewListStore();
  const [priority, setPriority] = React.useState<ReviewPriority>('MEDIUM');
  const [assignee, setAssignee] = React.useState('');
  const [remark, setRemark] = React.useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);

  const existingItem = addingRecordId ? getItem(addingRecordId) : null;

  React.useEffect(() => {
    if (addDialogOpen && existingItem) {
      setPriority(existingItem.priority);
      setAssignee(existingItem.assignee);
      setRemark(existingItem.remark);
    } else if (addDialogOpen) {
      setPriority('MEDIUM');
      setAssignee('');
      setRemark('');
    }
    setShowDeleteConfirm(false);
  }, [addDialogOpen, existingItem]);

  if (!addDialogOpen) return null;

  const handleSave = () => {
    if (existingItem) {
      update(addingRecordId!, {
        priority,
        assignee: assignee.trim(),
        remark: remark.trim(),
      });
    } else {
      saveAdd({
        priority,
        assignee: assignee.trim(),
        remark: remark.trim(),
      });
    }
  };

  const handleDelete = () => {
    if (addingRecordId) {
      remove(addingRecordId);
      closeAddDialog();
    }
  };

  const handleToggleStatus = () => {
    if (addingRecordId && existingItem) {
      const newStatus: ReviewStatus = existingItem.status === 'PENDING' ? 'REVIEWED' : 'PENDING';
      update(addingRecordId, { status: newStatus });
    }
  };

  const priorities: ReviewPriority[] = ['HIGH', 'MEDIUM', 'LOW'];

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="card p-0 max-w-lg w-full max-h-[85vh] overflow-hidden flex flex-col">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="font-title text-lg text-slate-900">
              {existingItem ? '编辑待讲清单' : '加入待讲清单'}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              清单数据独立存储，不影响原始训练记录
            </p>
          </div>
          <button onClick={closeAddDialog} className="btn-ghost p-2">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-4">
          {existingItem && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-medium text-slate-500 mb-1">当前状态</div>
                  <span className={classNames(
                    'text-xs px-2 py-1 rounded border font-bold',
                    existingItem.status === 'PENDING'
                      ? 'bg-amber-50 text-amber-700 border-amber-200'
                      : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  )}>
                    {existingItem.status === 'PENDING' ? (
                      <><Clock size={10} className="inline mr-1" /> 待讲</>
                    ) : (
                      <><CheckCircle size={10} className="inline mr-1" /> 已讲</>
                    )}
                  </span>
                </div>
                <button
                  onClick={handleToggleStatus}
                  className={classNames(
                    'btn-ghost text-xs',
                    existingItem.status === 'PENDING' ? 'text-emerald-600' : 'text-amber-600'
                  )}
                >
                  {existingItem.status === 'PENDING' ? '标记已讲' : '撤回到待讲'}
                </button>
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              <Flag size={14} className="inline mr-1" />
              讲评优先级
            </label>
            <div className="grid grid-cols-3 gap-2">
              {priorities.map((p) => {
                const colors = REVIEW_PRIORITY_COLOR[p];
                return (
                  <label
                    key={p}
                    className={classNames(
                      'flex items-center justify-center gap-2 p-3 rounded-xl border cursor-pointer transition-all text-sm font-medium',
                      priority === p
                        ? `${colors.bg} ${colors.border} ${colors.text} border-2`
                        : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                    )}
                  >
                    <input
                      type="radio"
                      name="priority"
                      checked={priority === p}
                      onChange={() => setPriority(p)}
                      className="sr-only"
                    />
                    <span className={classNames('w-2 h-2 rounded-full', colors.dot)}></span>
                    {REVIEW_PRIORITY_LABEL[p]}
                  </label>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              <User size={14} className="inline mr-1" />
              负责人
            </label>
            <input
              type="text"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              placeholder="输入负责讲评的教练姓名"
              className="input"
              maxLength={50}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              <MessageSquare size={14} className="inline mr-1" />
              备注
            </label>
            <textarea
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="一句话备注讲评要点、重点关注内容等..."
              className="input min-h-[80px] resize-y"
              maxLength={200}
            />
          </div>
        </div>

        <div className="p-5 border-t border-slate-100 flex items-center justify-between">
          {existingItem ? (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="btn-soft-red text-sm"
            >
              <Trash2 size={14} /> 从清单移除
            </button>
          ) : (
            <div />
          )}
          <div className="flex gap-3">
            <button className="btn-ghost" onClick={closeAddDialog}>
              取消
            </button>
            <button
              className="btn-primary"
              onClick={handleSave}
            >
              {existingItem ? '保存修改' : '加入待讲'}
            </button>
          </div>
        </div>
      </div>

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
          <div className="card p-6 max-w-sm w-full">
            <h3 className="font-title text-lg mb-2">确认从待讲清单移除？</h3>
            <p className="text-sm text-slate-600 mb-5">
              移除后清单数据将被清除，但原始训练记录不受影响。
            </p>
            <div className="flex gap-3 justify-end">
              <button className="btn-ghost" onClick={() => setShowDeleteConfirm(false)}>
                取消
              </button>
              <button className="btn-danger" onClick={handleDelete}>
                确认移除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
