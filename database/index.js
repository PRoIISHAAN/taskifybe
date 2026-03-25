import mongoose from "mongoose";
const objectid = mongoose.Types.ObjectId;

const labelsSchema = new mongoose.Schema({
  userId: { type: objectid, ref: "User" },
  title: String,
  color: String,
  boardId: { type: objectid, ref: "Board" },
});
const LabelModel = mongoose.model("Labels", labelsSchema);

const ChatSchenma = new mongoose.Schema({
  chat: String,
  userId: { type: objectid, ref: "User" },
  timeAdded: { type: Date, default: Date.now },
  boardId: { type: objectid, ref: "Board" },
  todoId: { type: objectid, ref: "Todo" },
});
const ChatModel = mongoose.model("Chat", ChatSchenma);
const UserSchema = new mongoose.Schema({
  FirstName: { type: String },
  LastName: { type: String },
  email: { type: String, required: true, unique: true },
  verified: { type: Boolean, default: false },
  boards: [{ type: objectid, ref: "Board", privilege: String }],
  avatarURL: { type: String },
  initials: { type: String },
  avatarColor: { type: String },
  password: { type: String },
  username: { type: String, required: true, unique: true },
});
const UserModel = mongoose.model("User", UserSchema);

const checklistItemSchema = new mongoose.Schema({
  due: { type: Date },
  assignedto: { type: objectid, ref: "User" },
  title: String,
  completed: { type: Boolean, default: false },
  type: String,
  href: String,
});

const recentlyViewedSchema = new mongoose.Schema({
  userId: { type: objectid, ref: "User" },
  recentlyViewed:[{timeAdded:{type:Date,default:Date.now},todoId:{type:objectid,ref:"Todo"}}],
})
const recentlyViewedModel = mongoose.model("recentlyViewed", recentlyViewedSchema)

const checklistSchema = new mongoose.Schema({
  items: [checklistItemSchema],
  title: String,
  userId: { type: objectid, ref: "User" },
  todoId: { type: objectid, ref: "Todo" },
  boardId: { type: objectid, ref: "Board" },
});
const CheckListModel = mongoose.model("Checklist", checklistSchema);



const TodoSchema = new mongoose.Schema({
  completed: { type: Boolean, default: false },
  archived: { type: Boolean, default: false },
  title: String,
  desc: String,
  updated:{type:Date, default:Date.now()},
  endDate: Date,
  startDate: { type: Date },
  timeAdded: { type: Date, default: Date.now() },
  priority: String,
  boardId: { type: objectid, ref: "Board" },
  userId: { type: objectid, ref: "User" },
  columnId: { type: objectid, ref: "column" },
  cover:String,
  attachments: {trelloCards:[{todoId:{type:objectid, ref:"Todo"}}],links:[{link:String,title:String}]},
  location: { type: String },
  checklist: [{ type: objectid, ref: "Checklist" }],
  reminder: String,
  labels: [{ type: objectid, ref: "Labels" }],
  members: [{ type: objectid, ref: "User" }],
});
const TodoModel = mongoose.model("Todo", TodoSchema);

const columnDataSchema = new mongoose.Schema({
  title: String,
  archived: { type: Boolean, default: false },
  tasks: [{ type: objectid, ref: "Todo" }],
  boardId: { type: objectid, ref: "Board" },
  userId: { type: objectid, ref: "User" },
  color: { type: String, default: null },
  watch: { type: Boolean, default: false },
});

const column_orderdataSchema = new mongoose.Schema({
  column_order: [{ type: String }],
  boardId: { type: objectid, ref: "Board" },
  userId: { type: objectid, ref: "User" },
});

const workspaceSchema = new mongoose.Schema({
  title: String,
  description: String,
  workspaceGuests: [{ type: objectid, ref: "User" }],
  workspaceAdmins: [{ type: objectid, ref: "User" }],
  boards: [{ type: objectid, ref: "Board" }],
})
const workspaceModel = mongoose.model("workspace", workspaceSchema);

const BoardSchema = new mongoose.Schema({
  title: String,
  bgColor: String,
  workspace: { type: objectid, ref: "workspace" },
  inviteLink:{token:String,privilege:{type:String, enum:["Member","Observer"]}, creator:{type:objectid, ref:"User"}},
  Admins: [{ type: objectid, ref: "User" }],
  Members: [{ type: objectid, ref: "User" }],
  Observers: [{ type: objectid, ref: "User" }],
  columnOrder: [{ type: objectid, ref: "column_order" }],
  columns: [{ type: objectid, ref: "column" }],
  tasks: [{ type: objectid, ref: "Todo" }],
});

function normalizeRoleIds(ids) {
  const seen = new Set();
  return (ids || []).filter((id) => {
    const key = String(id || "");
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

BoardSchema.pre("validate", function (next) {
  const admins = normalizeRoleIds(this.Admins);
  const members = normalizeRoleIds(this.Members).filter(
    (id) => !admins.some((adminId) => String(adminId) === String(id)),
  );
  const observers = normalizeRoleIds(this.Observers).filter(
    (id) =>
      !admins.some((adminId) => String(adminId) === String(id)) &&
      !members.some((memberId) => String(memberId) === String(id)),
  );

  this.Admins = admins;
  this.Members = members;
  this.Observers = observers;
  next();
});

const boardModel = mongoose.model("Board", BoardSchema);
const columnDataModel = mongoose.model("column", columnDataSchema);
const column_orderdataModel = mongoose.model(
  "column_order",
  column_orderdataSchema
);

export {
  UserModel,
  TodoModel,
  columnDataModel,
  column_orderdataModel,
  boardModel,
  CheckListModel,
  LabelModel,
  ChatModel,
  recentlyViewedModel,
  workspaceModel
};
