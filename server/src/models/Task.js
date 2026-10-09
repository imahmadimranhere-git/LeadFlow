// A task inside a project (kanban card).
import mongoose from '../config/mongoose.js';
import tenantScopePlugin from './plugins/tenantScope.js';
import { TASK_STATUSES, TASK_PRIORITIES } from '../config/erpOptions.js';

const taskSchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    title: { type: String, trim: true, maxlength: 200, required: true },
    description: { type: String, trim: true, maxlength: 5000, default: '' },
    status: { type: String, enum: TASK_STATUSES, default: 'TODO' },
    priority: { type: String, enum: TASK_PRIORITIES, default: 'MEDIUM' },
    assigneeId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    milestoneId: { type: mongoose.Schema.Types.ObjectId, default: null },
    dueDate: { type: Date, default: null },
    estimateMinutes: { type: Number, min: 0, max: 100000, default: null },
    position: { type: Number, default: 0 }, // order inside a column
    completedAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, strict: 'throw' }
);

taskSchema.plugin(tenantScopePlugin);
taskSchema.index({ tenantId: 1, projectId: 1, status: 1, position: 1 });
taskSchema.index({ tenantId: 1, assigneeId: 1, status: 1, dueDate: 1 });

const Task = mongoose.models.Task || mongoose.model('Task', taskSchema);
export default Task;
