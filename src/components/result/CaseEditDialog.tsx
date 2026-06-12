import React from 'react';
import { X, Tag, FileText, Star, Archive, Trash2 } from 'lucide-react';
import { useCaseStore } from '../../store/caseStore';
import { classNames } from '../../utils/uuid';

export function CaseEditDialog() {
  const { editDialogOpen, editingCase, closeEditDialog, saveEdit, remove } = useCaseStore();
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [tagsInput, setTagsInput] = React.useState('');
  const [recommended, setRecommended] = React.useState(false);
  const [archived, setArchived] = React.useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);

  React.useEffect(() => {
    if (editDialogOpen && editingCase) {
      setTitle(editingCase.title);
      setDescription(editingCase.description);
      setTagsInput(editingCase.tags.join(', '));
      setRecommended(editingCase.recommended);
      setArchived(editingCase.archived);
    } else if (editDialogOpen) {
      setTitle('');
      setDescription('');
      setTagsInput('');
      setRecommended(false);
      setArchived(false);
    }
    setShowDeleteConfirm(false);
  }, [editDialogOpen, editingCase]);

  if (!editDialogOpen) return null;

  const tags = tagsInput
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  const handleSave = () => {
    saveEdit({
      title: title.trim(),
      description: description.trim(),
      tags,
      recommended,
      archived,
    });
  };

  const handleDelete = () => {
    if (editingCase) {
      remove(editingCase.recordId);
      closeEditDialog();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="card p-0 max-w-lg w-full max-h-[85vh] overflow-hidden flex flex-col">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="font-title text-lg text-slate-900">
              {editingCase ? '编辑案例' : '保存为案例'}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              案例数据独立存储，不影响原始训练记录
            </p>
          </div>
          <button onClick={closeEditDialog} className="btn-ghost p-2">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              <FileText size={14} className="inline mr-1" />
              案例标题
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如：典型胸痛分诊案例"
              className="input"
              maxLength={100}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              适用场景 / 备注
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="描述这个案例适合什么场景，教学要点是什么..."
              className="input min-h-[80px] resize-y"
              maxLength={500}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              <Tag size={14} className="inline mr-1" />
              标签（用逗号分隔）
            </label>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="例如：胸痛, 初学者, 高分参考"
              className="input"
            />
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {tags.map((tag, idx) => (
                  <span
                    key={idx}
                    className="text-[11px] px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-200"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className={classNames(
              'flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all',
              recommended
                ? 'bg-amber-50 border-amber-300'
                : 'bg-white border-slate-200 hover:border-slate-300'
            )}>
              <input
                type="checkbox"
                checked={recommended}
                onChange={(e) => setRecommended(e.target.checked)}
                className="accent-amber-500"
              />
              <div>
                <div className="text-sm font-medium text-slate-800 flex items-center gap-1.5">
                  <Star size={14} className={recommended ? 'text-amber-500' : 'text-slate-400'} />
                  设为推荐
                </div>
                <div className="text-[11px] text-slate-500">突出显示，便于快速找到</div>
              </div>
            </label>

            <label className={classNames(
              'flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all',
              archived
                ? 'bg-slate-100 border-slate-300'
                : 'bg-white border-slate-200 hover:border-slate-300'
            )}>
              <input
                type="checkbox"
                checked={archived}
                onChange={(e) => setArchived(e.target.checked)}
                className="accent-slate-500"
              />
              <div>
                <div className="text-sm font-medium text-slate-800 flex items-center gap-1.5">
                  <Archive size={14} className={archived ? 'text-slate-600' : 'text-slate-400'} />
                  归档
                </div>
                <div className="text-[11px] text-slate-500">隐藏但保留数据</div>
              </div>
            </label>
          </div>
        </div>

        <div className="p-5 border-t border-slate-100 flex items-center justify-between">
          {editingCase ? (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="btn-soft-red text-sm"
            >
              <Trash2 size={14} /> 删除案例
            </button>
          ) : (
            <div />
          )}
          <div className="flex gap-3">
            <button className="btn-ghost" onClick={closeEditDialog}>
              取消
            </button>
            <button
              className="btn-primary"
              onClick={handleSave}
              disabled={!title.trim()}
            >
              {editingCase ? '保存修改' : '保存案例'}
            </button>
          </div>
        </div>
      </div>

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
          <div className="card p-6 max-w-sm w-full">
            <h3 className="font-title text-lg mb-2">确认删除案例？</h3>
            <p className="text-sm text-slate-600 mb-5">
              删除后案例数据将被清除，但原始训练记录不受影响。
            </p>
            <div className="flex gap-3 justify-end">
              <button className="btn-ghost" onClick={() => setShowDeleteConfirm(false)}>
                取消
              </button>
              <button className="btn-danger" onClick={handleDelete}>
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
