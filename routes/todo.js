import { Router } from "express";
import { userMiddleware } from "../middleware/user.js";
import {
  TodoModel,
  columnDataModel,
  column_orderdataModel,
  LabelModel,
  CheckListModel,
  recentlyViewedModel,
  boardModel,
} from "../database/index.js";
import mongoose from "mongoose";
const router = Router();
const isValidObjectId = (value) => mongoose.isValidObjectId(value);

router.post("/", userMiddleware, async (req, res) => {
  try {
    const { title, desc, due, priority, columnId, collumnId, boardId } = req.body;
    const resolvedColumnId = columnId || collumnId;
    const userId = req.userId;

    if (!isValidObjectId(resolvedColumnId) || !isValidObjectId(boardId)) {
      return res.status(400).json({ message: "Invalid boardId or columnId" });
    }

    const todo = await TodoModel.create({
      title: title,
      desc: desc,
      priority: priority,
      due: due,
      boardId: boardId,
      columnId: resolvedColumnId,
      userId: userId,
    });
    const updatedColumn = await columnDataModel.findByIdAndUpdate(
      resolvedColumnId,
      {
        $push: { tasks: todo._id },
      },
      { new: true }
    );
    res.status(200).json({
      todo,
      updatedColumn,
      updatedCollumn: updatedColumn,
    });
  } catch (error) {
    console.error("Failed to create todo:", error);
    res.status(500).json({ message: "Failed to create todo" });
  }
});
router.post("/addlabel", async (req, res) => {
  const { color, title } = req.body;
  const userId = req.userId;
  const add = await LabelModel.create({
    title: title,
    color: color,
    userId: userId,
  });
  res.json({
    result: add,
  });
});
router.get("/recentlyviewed", userMiddleware, async (req, res) => {
  const userId = req.userId;
  const recentlyviewed = await recentlyViewedModel
    .findOne({ userId: userId })
    .populate("recentlyViewed.todoId")
    .populate("recentlyViewed.todoId.boardId");
  res.json(recentlyviewed);
});

router.post("/recentlyviewed", userMiddleware, async (req, res) => {
  const { todoId } = req.body;
  const userId = req.userId;
  const recentlyviewed = await recentlyViewedModel.findOneAndUpdate(
    { userId: userId },
    [
      {
        $set: {
          recentlyViewed: {
            $filter: {
              input: "$recentlyViewed",
              cond: {
                $ne: ["$$this.todoId", new mongoose.Types.ObjectId(todoId)],
              },
            },
          },
        },
      },
      {
        $set: {
          recentlyViewed: {
            $slice: [
              {
                $concatArrays: [
                  [
                    {
                      todoId: new mongoose.Types.ObjectId(todoId),
                      timeAdded: new Date(),
                    },
                  ],
                  "$recentlyViewed",
                ],
              },
              4,
            ],
          },
        },
      },
    ],
    {
      new: true,
      upsert: true,
    }
  );
  res.json(recentlyviewed);
});

router.get('/get-metadata', async (req, res) => {
  const { link } = req.query;
  
  if (!link) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    const response = await fetch(link, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 5000
    });
    
    const html = await response.text();
    
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : null;

    const domain = new URL(link).hostname;
    
    res.json({
      title: title || domain
    });
    
  } catch (error) {
    console.error('Error fetching metadata:', error);
    res.status(500).json({ 
      error: 'Failed to fetch metadata',
      title: new URL(link).hostname 
    });
  }
});

router.post("/addAttachment", userMiddleware, async (req, res) => {
  let { type, todoId, todoIdAtt, title, link } = req.body;
  
  const userId = req.userId;
  if (type == "trelloCards") {
    const update = await TodoModel.updateOne(
      { userId: userId, _id: todoId },
      {
        $push: { "attachments.trelloCards": { todoId: todoIdAtt } },
        $set: { update: Date.now() },
      }
    );
    res.json(update);
  } else if (type == "link") {
    if (!link.startsWith("https://") && !link.startsWith("http://")) {
    link = "https://" + link;
  }
  if (!title) {
    const response = await fetch(link, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 5000
    });
    
    const html = await response.text();
    
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    let title = titleMatch ? titleMatch[1].trim() : null;

    const domain = new URL(link).hostname;
    title = title || domain;
  }
    const update = await TodoModel.updateOne(
      { userId: userId, _id: todoId },
      {
        $push: { "attachments.links": { link: link, title: title } },
        $set: { update: Date.now() },
      }
    );
    res.json(update);
  }
});

router.put("/addAttachment", userMiddleware, async (req, res) => {
  let { type, todoId, title, link, index } = req.body;
  
  const userId = req.userId;
   if (type == "link") {
    if (!link.startsWith("https://") && !link.startsWith("http://")) {
    link = "https://" + link;
  }
  if (!title) {
    const response = await fetch(link, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 5000
    });
    
    const html = await response.text();
    
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    let title = titleMatch ? titleMatch[1].trim() : null;

    const domain = new URL(link).hostname;
    title = title || domain;
  }
    const update = await TodoModel.updateOne(
      { userId: userId, _id: todoId },
      {
      $set: { 
        [`attachments.links.${index}.link`]: link,
        [`attachments.links.${index}.title`]: title,
        update: Date.now() 
      }
    }
    );
    res.json(update);
  }
});

router.put("/reorderAttachmentLink", userMiddleware, async (req, res) => {
  const { todoId, index, newIndex } = req.body;
  const userId = req.userId;

  const todo = await TodoModel.findOne({ userId: userId, _id: todoId });
  
  const links = [...todo.attachments.links];
  const [draggedItem] = links.splice(index, 1);
  links.splice(newIndex, 0, draggedItem);

  const update = await TodoModel.updateOne(
    { userId: userId, _id: todoId },
    {
      $set: {
        "attachments.links": links,
        update: Date.now()
      }
    }
  );
  
  res.json(update);
});

router.delete("/addAttachment/:type/:todoId/:index", userMiddleware, async (req, res) => {
  const { type, todoId, index } = req.params;
  
  const userId = req.userId;
  if (type == "trelloCards") {
    const update = await TodoModel.updateOne(
      { userId: userId, _id: todoId },
      {
        $unset: { [`attachments.trelloCards.${index}`]: 1 },
        $set: { update: Date.now() },
      }
    );
    const cleanup = await TodoModel.updateOne(
    { userId: userId, _id: todoId },
    {
      $pull: { "attachments.trelloCards": null }
    }
  );
    res.json(update);
  } else if (type == "link") {
    const update = await TodoModel.updateOne(
      { userId: userId, _id: todoId },
      {
       $unset: { [`attachments.links.${index}`]: 1 },
        $set: { update: Date.now() },
      }
    );
    const cleanup = await TodoModel.updateOne(
    { userId: userId, _id: todoId },
    {
      $pull: { "attachments.links": null }
    }
  );
    res.json(update);
  }
});


router.post("/createchecklist", userMiddleware, async (req, res) => {
  const { title, copyFrom, todoId } = req.body;
  const userId = req.userId;
  if (copyFrom == "(none)") {
    const checklist = await CheckListModel.create({
      title: title,
      userId: userId,
      todoId: todoId,
    });
    await TodoModel.updateOne(
      { userId: userId, _id: todoId },
      {
        $push: { checklist: checklist._id },
        $set: { updated: Date.now() },
      }
    );
    res.json({ result: checklist });
  } else {
    const item = await CheckListModel.findOne({
      userId: userId,
      _id: copyFrom,
    });
    const checklist = await CheckListModel.create({
      title: title,
      userId: userId,
      todoId: todoId,
      items: item.items,
    });
    res.json({ result: checklist });
  }
});

router.post("/addChecklistItem", userMiddleware, async (req, res) => {
  const { title, checklistId, assignedto, due } = req.body;
  const userId = req.userId;
  const checklist = await CheckListModel.updateOne(
    { userId: userId, _id: checklistId },
    {
      $push: {
        items: {
          title: title,
          assignedto: assignedto,
          due: due,
          type: "todo",
        },
      },
    }
  );
  res.json({ result: checklist });
});

router.put("/EditChecklistItem", userMiddleware, async (req, res) => {
  const { title, checklistId, checkItemId, completed, assignedto, due } =
    req.body;
  const userId = req.userId;
  const checklist = await CheckListModel.updateOne(
    { userId: userId, _id: checklistId, "items._id": checkItemId },
    {
      $set: {
        "items.$.title": title,
        "items.$.assignedto": assignedto,
        "items.$.due": due,
        "items.$.type": "todo",
        "items.$.completed": completed,
      },
    }
  );
  res.json({ result: checklist });
});



router.delete(
  "/DeleteChecklist/:checklistId",
  userMiddleware,
  async (req, res) => {
    const checklistId = req.params.checklistId;
    const userId = req.userId;
    await CheckListModel.deleteOne({ userId: userId, _id: checklistId });
    res.json({ result: "Success" });
  }
);

router.delete(
  "/DeleteChecklistItem/:checklistId/:index",
  userMiddleware,
  async (req, res) => {
    const index = parseInt(req.params.index);
    const checklistId = req.params.checklistId;
    const userId = req.userId;
    await CheckListModel.updateOne(
      { userId: userId, _id: checklistId },
      { $unset: { [`items.${index}`]: 1 } }
    );

    const result = await CheckListModel.updateOne(
      { userId: userId, _id: checklistId },
      { $pull: { items: null } }
    );
    res.json({ result: result });
  }
);

router.put("/editChecklistTitle", userMiddleware, async (req, res) => {
  const { title, checklistId } = req.body;
  const userId = req.userId;
  const update = await CheckListModel.updateOne(
    { userId: userId, _id: checklistId },
    { $set: { title: title } }
  );
  res.json(update);
});

router.put("/modifylabel", async (req, res) => {
  const userId = req.userId;
  const { color, title, labelId } = req.body;
  const update = await LabelModel.updateOne(
    { userId: userId, _id: labelId },
    { color: color, title: title }
  );
  console.log(update);
  res.json(update);
});

router.delete("/modifylabel/:labelId", async (req, res) => {
  const userId = req.userId;
  const labelId = req.params.labelId;
  const update = await LabelModel.deleteOne({ userId: userId, _id: labelId });
  console.log(update);
  res.json(update);
});

router.put("/modifylabelslist", async (req, res) => {
  const userId = req.userId;
  const { labels, todoId } = req.body;
  const update = await TodoModel.updateOne(
    { userId: userId, _id: todoId },
    { labels: labels, $set: { updated: Date.now() } }
  );
  console.log(update);
  res.json(update);
});

router.get("/getlabels", async (req, res) => {
  const userId = req.userId;
  const userlabels = await LabelModel.find({ userId: userId });
  res.json({
    userLabels: userlabels,
  });
});

router.post("/adddate", async (req, res) => {
  const userId = req.userId;
  let startDate = null;
  let endDate = null;
  const { startDateCheck, endDateCheck, todoId, reminder } = req.body;
  console.log(todoId, userId);
  try {
    if (startDateCheck) {
      startDate = new Date(req.body.startDate);
    } else {
      startDate = Date.now();
    }
    if (endDateCheck) {
      endDate = new Date(req.body.endDate);
    }
    const update = await TodoModel.updateOne(
      { userId: userId, _id: todoId },
      {
        $set: {
          startDate: startDate,
          endDate: endDate,
          reminder: reminder,
          updated: Date.now(),
        },
      }
    );
    console.log(update);
    res.json({
      result: "Success",
    });
  } catch (error) {
    res.status(500).json({
      result: "Error",
    });
  }
});

router.delete("/adddate/:todoId", userMiddleware, async (req, res) => {
  const userId = req.userId;
  const todoId = req.params.todoId;
  try {
    await TodoModel.updateOne(
      { userId: userId, _id: todoId },
      {
        $unset: { startDate: null, endDate: null, reminder: null },
        $set: { updated: Date.now() },
      }
    );
    res.json({
      result: "Success",
    });
  } catch (error) {
    res.status(500).json({
      result: "Error",
    });
  }
});

router.post("/createcollumn", userMiddleware, async (req, res) => {
  try {
    const { title, boardId } = req.body;
    const userId = req.userId;

    if (!isValidObjectId(boardId)) {
      return res.status(400).json({ message: "Invalid boardId" });
    }

    const column = await columnDataModel.create({
      title: title,
      boardId: boardId,
      userId: userId,
    });
    let column_order = await column_orderdataModel.findOneAndUpdate(
      { userId: userId, boardId: boardId },
      {
        $push: { column_order: column._id },
      }
    );
    if (!column_order) {
      column_order = await column_orderdataModel.create({
        column_order: [column._id],
        userId: userId,
        boardId: boardId,
      });
    }
    res.json({ column: column, column: column });
  } catch (error) {
    console.error("Failed to create column:", error);
    res.status(500).json({ message: "Failed to create column" });
  }
});

router.post("/duplicatelist", userMiddleware, async (req, res) => {
  try {
    const { sourceColumnId, title } = req.body;
    const userId = req.userId;
    const trimmedTitle = title?.trim();

    if (!sourceColumnId || !trimmedTitle) {
      return res
        .status(400)
        .json({ message: "sourceColumnId and title are required" });
    }

    const sourceColumn = await columnDataModel.findOne({
      _id: sourceColumnId,
      userId: userId,
    });

    if (!sourceColumn) {
      return res.status(404).json({ message: "Source column not found" });
    }

    const duplicatedColumn = await columnDataModel.create({
      title: trimmedTitle,
      boardId: sourceColumn.boardId,
      userId: userId,
      color: sourceColumn.color || null,
      tasks: [],
    });

    const sourceTaskIds = Array.isArray(sourceColumn.tasks)
      ? sourceColumn.tasks
      : [];
    const sourceTodos = await TodoModel.find({
      userId: userId,
      _id: { $in: sourceTaskIds },
    });

    const sourceTodoMap = new Map(
      sourceTodos.map((todo) => [String(todo._id), todo])
    );
    const orderedSourceTodos = sourceTaskIds
      .map((taskId) => sourceTodoMap.get(String(taskId)))
      .filter(Boolean);

    const duplicatedTodos = [];

    for (const sourceTodo of orderedSourceTodos) {
      const sourceTodoObject = sourceTodo.toObject();
      const {
        _id,
        __v,
        checklist: sourceChecklistIds,
        timeAdded,
        ...todoPayload
      } = sourceTodoObject;

      const duplicatedTodo = await TodoModel.create({
        ...todoPayload,
        userId: userId,
        boardId: sourceColumn.boardId,
        columnId: duplicatedColumn._id,
        checklist: [],
        timeAdded: new Date(),
        updated: new Date(),
      });

      const checklistIds = Array.isArray(sourceChecklistIds)
        ? sourceChecklistIds
        : [];
      if (checklistIds.length > 0) {
        const sourceChecklists = await CheckListModel.find({
          userId: userId,
          _id: { $in: checklistIds },
        });
        const sourceChecklistMap = new Map(
          sourceChecklists.map((item) => [String(item._id), item])
        );

        const duplicatedChecklistIds = [];
        for (const checklistId of checklistIds) {
          const sourceChecklist = sourceChecklistMap.get(String(checklistId));
          if (!sourceChecklist) {
            continue;
          }

          const duplicatedChecklist = await CheckListModel.create({
            title: sourceChecklist.title,
            items: sourceChecklist.items,
            userId: userId,
            todoId: duplicatedTodo._id,
            boardId: sourceColumn.boardId,
          });
          duplicatedChecklistIds.push(duplicatedChecklist._id);
        }

        if (duplicatedChecklistIds.length > 0) {
          await TodoModel.updateOne(
            { userId: userId, _id: duplicatedTodo._id },
            { $set: { checklist: duplicatedChecklistIds } }
          );
          duplicatedTodo.checklist = duplicatedChecklistIds;
        }
      }

      duplicatedTodos.push(duplicatedTodo);
    }

    const duplicatedTaskIds = duplicatedTodos.map((todo) => todo._id);
    await columnDataModel.updateOne(
      { userId: userId, _id: duplicatedColumn._id },
      { $set: { tasks: duplicatedTaskIds } }
    );

    const finalizedColumn = await columnDataModel.findById(duplicatedColumn._id);

    let columnOrderDoc = await column_orderdataModel.findOne({ userId: userId });
    if (!columnOrderDoc) {
      columnOrderDoc = await column_orderdataModel.create({
        userId: userId,
        boardId: sourceColumn.boardId,
        column_order: [sourceColumn._id, duplicatedColumn._id],
      });
    } else {
      const nextOrder = Array.isArray(columnOrderDoc.column_order)
        ? columnOrderDoc.column_order.map((id) => String(id))
        : [];
      const sourceIndex = nextOrder.indexOf(String(sourceColumn._id));

      if (sourceIndex === -1) {
        nextOrder.push(String(duplicatedColumn._id));
      } else {
        nextOrder.splice(sourceIndex + 1, 0, String(duplicatedColumn._id));
      }

      columnOrderDoc.column_order = nextOrder;
      await columnOrderDoc.save();
    }

    const duplicatedTodoIds = duplicatedTodos.map((todo) => todo._id);
    const duplicatedTodosPopulated = await TodoModel.find({
      userId: userId,
      _id: { $in: duplicatedTodoIds },
    })
      .populate("labels")
      .populate("members", "FirstName")
      .populate("checklist")
      .populate("attachments.trelloCards.todoId")
      .populate("attachments.trelloCards.todoId.boardId");

    const duplicatedTodoMap = new Map(
      duplicatedTodosPopulated.map((todo) => [String(todo._id), todo])
    );
    const orderedDuplicatedTodos = duplicatedTodoIds
      .map((todoId) => duplicatedTodoMap.get(String(todoId)))
      .filter(Boolean);

    res.status(201).json({
      column: finalizedColumn,
      todos: orderedDuplicatedTodos,
      column_order: columnOrderDoc.column_order,
    });
  } catch (error) {
    console.error("Failed to duplicate list:", error);
    res.status(500).json({ message: "Failed to duplicate list" });
  }
});

router.put("/movelist", userMiddleware, async (req, res) => {
  try {
    const { columnId, targetBoardId, targetPosition } = req.body;
    const userId = req.userId;

    if (!columnId || !targetBoardId || !Number.isFinite(Number(targetPosition))) {
      return res.status(400).json({ message: "Invalid move list payload" });
    }

    if (!isValidObjectId(columnId) || !isValidObjectId(targetBoardId)) {
      return res.status(400).json({ message: "Invalid boardId or columnId" });
    }

    const sourceColumn = await columnDataModel.findOne({
      userId: userId,
      _id: columnId,
    });

    if (!sourceColumn) {
      return res.status(404).json({ message: "Column not found" });
    }

    const sourceBoardId = String(sourceColumn.boardId || "");
    const targetBoardIdString = String(targetBoardId || "");
    const movingWithinSameBoard = sourceBoardId === targetBoardIdString;

    let sourceColumnOrderDoc = await column_orderdataModel.findOne({
      userId: userId,
      boardId: sourceColumn.boardId,
    });

    if (!sourceColumnOrderDoc) {
      sourceColumnOrderDoc = await column_orderdataModel.create({
        userId: userId,
        boardId: sourceColumn.boardId,
        column_order: [String(sourceColumn._id)],
      });
    }

    let sourceOrder = Array.isArray(sourceColumnOrderDoc.column_order)
      ? sourceColumnOrderDoc.column_order.map((id) => String(id || ""))
      : [];

    sourceOrder = sourceOrder.filter((id) => id && id !== String(sourceColumn._id));

    let targetColumnOrderDoc = sourceColumnOrderDoc;
    let targetOrder = sourceOrder;

    if (!movingWithinSameBoard) {
      await columnDataModel.updateOne(
        { userId: userId, _id: sourceColumn._id },
        { $set: { boardId: targetBoardId } }
      );

      await TodoModel.updateMany(
        { userId: userId, columnId: sourceColumn._id },
        { $set: { boardId: targetBoardId } }
      );

      const todoIdsInColumn = Array.isArray(sourceColumn.tasks)
        ? sourceColumn.tasks
        : [];

      if (todoIdsInColumn.length > 0) {
        await CheckListModel.updateMany(
          {
            userId: userId,
            todoId: { $in: todoIdsInColumn },
          },
          { $set: { boardId: targetBoardId } }
        );
      }

      targetColumnOrderDoc = await column_orderdataModel.findOne({
        userId: userId,
        boardId: targetBoardId,
      });

      if (!targetColumnOrderDoc) {
        targetColumnOrderDoc = await column_orderdataModel.create({
          userId: userId,
          boardId: targetBoardId,
          column_order: [],
        });
      }

      targetOrder = Array.isArray(targetColumnOrderDoc.column_order)
        ? targetColumnOrderDoc.column_order.map((id) => String(id || ""))
        : [];

      targetOrder = targetOrder.filter((id) => id && id !== String(sourceColumn._id));
    }

    const insertionIndex = Math.max(
      0,
      Math.min(targetOrder.length, Number(targetPosition) - 1)
    );
    targetOrder.splice(insertionIndex, 0, String(sourceColumn._id));

    sourceColumnOrderDoc.column_order = movingWithinSameBoard
      ? targetOrder
      : sourceOrder;
    await sourceColumnOrderDoc.save();

    if (!movingWithinSameBoard) {
      targetColumnOrderDoc.column_order = targetOrder;
      await targetColumnOrderDoc.save();
    }

    const updatedColumn = await columnDataModel.findById(sourceColumn._id);

    res.status(200).json({
      message: "List moved successfully",
      column: updatedColumn,
      sourceColumnOrder: sourceColumnOrderDoc.column_order,
      targetColumnOrder: targetColumnOrderDoc.column_order,
    });
  } catch (error) {
    console.error("Failed to move list:", error);
    res.status(500).json({ message: "Failed to move list" });
  }
});

router.put("/moveallcards", userMiddleware, async (req, res) => {
  try {
    const { sourceColumnId, targetColumnId } = req.body;
    const userId = req.userId;

    if (!sourceColumnId || !targetColumnId) {
      return res
        .status(400)
        .json({ message: "sourceColumnId and targetColumnId are required" });
    }

    if (String(sourceColumnId) === String(targetColumnId)) {
      return res.status(200).json({ message: "No-op" });
    }

    const [sourceColumn, targetColumn] = await Promise.all([
      columnDataModel.findOne({ userId: userId, _id: sourceColumnId }),
      columnDataModel.findOne({ userId: userId, _id: targetColumnId }),
    ]);

    if (!sourceColumn || !targetColumn) {
      return res.status(404).json({ message: "Source or target column not found" });
    }

    const sourceTasks = Array.isArray(sourceColumn.tasks) ? sourceColumn.tasks : [];
    const targetTasks = Array.isArray(targetColumn.tasks) ? targetColumn.tasks : [];
    const nextTargetTasks = [...targetTasks, ...sourceTasks];

    await Promise.all([
      columnDataModel.updateOne(
        { userId: userId, _id: sourceColumnId },
        { $set: { tasks: [] } }
      ),
      columnDataModel.updateOne(
        { userId: userId, _id: targetColumnId },
        { $set: { tasks: nextTargetTasks } }
      ),
      TodoModel.updateMany(
        { userId: userId, _id: { $in: sourceTasks } },
        {
          $set: {
            columnId: targetColumn._id,
            boardId: targetColumn.boardId,
            updated: new Date(),
          },
        }
      ),
      CheckListModel.updateMany(
        { userId: userId, todoId: { $in: sourceTasks } },
        { $set: { boardId: targetColumn.boardId } }
      ),
    ]);

    res.status(200).json({
      message: "All cards moved successfully",
      sourceColumnId: String(sourceColumnId),
      targetColumnId: String(targetColumnId),
      sourceTasksCount: sourceTasks.length,
    });
  } catch (error) {
    console.error("Failed to move all cards:", error);
    res.status(500).json({ message: "Failed to move all cards" });
  }
});

router.put("/", userMiddleware, async (req, res) => {
  try {
    const { update, taskId, updatetype } = req.body;
    const userId = req.userId;

    const updated = await TodoModel.updateOne(
      { userId: userId, _id: taskId },
      { $set: { [updatetype]: update, updated: Date.now() } }
    );

    if (updated.modifiedCount === 0) {
      return res.status(404).json({ message: "Todo not found or no change" });
    }

    res.json({ message: "Todo updated successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

router.delete("/", userMiddleware, async (req, res) => {
  const { taskId } = req.body;
  const userId = req.userId;
  const deltodo = await TodoModel.deleteOne({
    userId: userId,
    _id: taskId,
  });
  res.json(deltodo);
});

router.delete("/:id", userMiddleware, async (req, res) => {
  const taskId = req.params.id;
  const userId = req.userId;
  const deltodo = await TodoModel.deleteOne({
    userId: userId,
    taskId: taskId,
  });
  res.json(deltodo);
});

router.get("/", userMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    const { boardId } = req.query;

    const todoQuery = { boardId: boardId };
    const columnQuery = { boardId: boardId };
    const columnOrderQuery = { boardId: boardId };

    if (boardId) {
      if (!mongoose.isValidObjectId(boardId)) {
        return res.status(400).json({ message: "Invalid boardId" });
      }

      const board = await boardModel
        .findById(boardId)
        .select("Admins Members Observers")
        .lean();

      if (!board) {
        return res.status(404).json({ message: "Board not found" });
      }

      const requesterId = String(userId);
      const isAllowed =
        (board.Admins || []).some((id) => String(id) === requesterId) ||
        (board.Members || []).some((id) => String(id) === requesterId) ||
        (board.Observers || []).some((id) => String(id) === requesterId);

      if (!isAllowed) {
        return res.status(403).json({ message: "You are not authorised" });
      }
    }

    const todos = await TodoModel.find(todoQuery)
      .populate("labels")
      .populate("members", "FirstName")
      .populate("checklist")
      .populate("attachments.trelloCards.todoId")
      .populate("attachments.trelloCards.todoId.boardId");
    const column = await columnDataModel.find(columnQuery);
    const column_order = await column_orderdataModel.find(columnOrderQuery);

    res.status(200).json({
      todos: todos,
      column: column,
      column_order: column_order,
      column: column,
      collumn_order: column_order,
    });
  } catch (error) {
    console.error("Failed to fetch todos:", error);
    res.status(500).json({ message: "Failed to fetch todos" });
  }
});

router.post("/updatetitle", userMiddleware, async (req, res) => {
  try {
    const { title, id, boardId } = req.body;
    const userId = req.userId;

    if (!isValidObjectId(id) || !isValidObjectId(boardId)) {
      return res.status(400).json({ message: "Invalid boardId or todoId" });
    }

    const update = await TodoModel.updateOne(
      { userId: userId, _id: id, boardId: boardId },
      { $set: { title: title, updated: Date.now() } }
    );
    console.log(update);
    res.json(update);
  } catch (error) {
    console.error("Failed to update title:", error);
    res.status(500).json({ message: "Failed to update title" });
  }
});

router.post("/updatecompleted", userMiddleware, async (req, res) => {
  try {
    const { completed, id, boardId } = req.body;
    const userId = req.userId;

    if (!isValidObjectId(id) || !isValidObjectId(boardId)) {
      return res.status(400).json({ message: "Invalid boardId or todoId" });
    }

    const update = await TodoModel.updateOne(
      { userId: userId, _id: id, boardId: boardId },
      { $set: { completed: completed, updated: Date.now() } }
    );
    console.log(update);
    res.json(update);
  } catch (error) {
    console.error("Failed to update completion:", error);
    res.status(500).json({ message: "Failed to update completion" });
  }
});

router.post("/reordertask", userMiddleware, async (req, res) => {
  const {
    columnId1,
    columnId2,
    collumnId1,
    collumnId2,
    taskarr1,
    taskarr2,
  } = req.body;
  const resolvedColumnId1 = columnId1 || collumnId1;
  const resolvedColumnId2 = columnId2 || collumnId2;
  const userId = req.userId;
  if (!resolvedColumnId2) {
    const update = await columnDataModel.updateOne(
      {
        userId: userId,
        _id: resolvedColumnId1,
      },
      { $set: { tasks: [...taskarr1] } }
    );
    res.json(update);
  } else if (resolvedColumnId2) {
    const update1 = await columnDataModel.updateOne(
      {
        userId: userId,
        _id: resolvedColumnId1,
      },
      { $set: { tasks: [...taskarr1] } }
    );
    const update2 = await columnDataModel.updateOne(
      {
        userId: userId,
        _id: resolvedColumnId2,
      },
      { $set: { tasks: [...taskarr2] } }
    );
    res.json({
      update1: update1,
      update2: update2,
    });
  }
});

router.post("/reordercollumn", userMiddleware, async (req, res) => {
  const { collarr } = req.body;
  const userId = req.userId;
  const update = await column_orderdataModel.updateOne(
    {
      userId: userId,
    },
    { column_order: collarr }
  );
  res.json(update);
});

async function updateColumnTitleHandler(req, res) {
  try {
    const { title, columnId } = req.body;
    const userId = req.userId;
    const trimmedTitle = title?.trim();

    if (!columnId || !trimmedTitle) {
      return res.status(400).json({ message: "columnId and title are required" });
    }

    const update = await columnDataModel.updateOne(
      { userId: userId, _id: columnId },
      { $set: { title: trimmedTitle } }
    );

    if (update.matchedCount === 0) {
      return res.status(404).json({ message: "Column not found" });
    }

    res.json(update);
  } catch (error) {
    console.error("Failed to update column title:", error);
    res.status(500).json({ message: "Failed to update column title" });
  }
}

router.put("/updatecolumn", userMiddleware, updateColumnTitleHandler);
router.put("/updatecollumntitle", userMiddleware, updateColumnTitleHandler);

async function updateColumnColorHandler(req, res) {
  try {
    const { columnId, color } = req.body;
    const userId = req.userId;

    if (!columnId) {
      return res.status(400).json({ message: "columnId is required" });
    }

    const update = await columnDataModel.updateOne(
      { userId: userId, _id: columnId },
      { $set: { color: color || null } }
    );

    if (update.matchedCount === 0) {
      return res.status(404).json({ message: "Column not found" });
    }

    res.json(update);
  } catch (error) {
    console.error("Failed to update column color:", error);
    res.status(500).json({ message: "Failed to update column color" });
  }
}

router.put("/updatecolumncolor", userMiddleware, updateColumnColorHandler);

router.put("/togglecolumnwatch", userMiddleware, async (req, res) => {
  try {
    const { columnId } = req.body;
    const userId = req.userId;

    if (!columnId) {
      return res.status(400).json({ message: "columnId is required" });
    }

    const column = await columnDataModel.findOne({
      userId: userId,
      _id: columnId,
    });

    if (!column) {
      return res.status(404).json({ message: "Column not found" });
    }

    const nextWatch = !Boolean(column.watch);
    column.watch = nextWatch;
    await column.save();

    res.json({
      message: "Column watch toggled",
      columnId: String(column._id),
      watch: nextWatch,
    });
  } catch (error) {
    console.error("Failed to toggle column watch:", error);
    res.status(500).json({ message: "Failed to toggle column watch" });
  }
});

router.put("/archivelist", userMiddleware, async (req, res) => {
  try {
    const { columnId } = req.body;
    const userId = req.userId;

    if (!columnId) {
      return res.status(400).json({ message: "columnId is required" });
    }

    const column = await columnDataModel.findOne({ userId: userId, _id: columnId });
    if (!column) {
      return res.status(404).json({ message: "Column not found" });
    }

    const taskIds = Array.isArray(column.tasks) ? column.tasks : [];

    await Promise.all([
      columnDataModel.updateOne(
        { userId: userId, _id: columnId },
        { $set: { archived: true, tasks: [] } }
      ),
      TodoModel.updateMany(
        { userId: userId, columnId: columnId },
        { $set: { archived: true, updated: new Date() } }
      ),
      column_orderdataModel.updateMany(
        { userId: userId },
        { $pull: { column_order: String(columnId) } }
      ),
    ]);

    res.json({
      message: "List archived",
      columnId: String(columnId),
      archivedTaskIds: taskIds.map((id) => String(id)),
    });
  } catch (error) {
    console.error("Failed to archive list:", error);
    res.status(500).json({ message: "Failed to archive list" });
  }
});

router.put("/archiveallcardsinlist", userMiddleware, async (req, res) => {
  try {
    const { columnId } = req.body;
    const userId = req.userId;

    if (!columnId) {
      return res.status(400).json({ message: "columnId is required" });
    }

    const column = await columnDataModel.findOne({ userId: userId, _id: columnId });
    if (!column) {
      return res.status(404).json({ message: "Column not found" });
    }

    const taskIds = Array.isArray(column.tasks) ? column.tasks : [];

    await Promise.all([
      TodoModel.updateMany(
        { userId: userId, columnId: columnId, archived: { $ne: true } },
        { $set: { archived: true, updated: new Date() } }
      ),
      columnDataModel.updateOne(
        { userId: userId, _id: columnId },
        { $set: { tasks: [] } }
      ),
    ]);

    res.json({
      message: "All cards in list archived",
      columnId: String(columnId),
      archivedTaskIds: taskIds.map((id) => String(id)),
    });
  } catch (error) {
    console.error("Failed to archive cards in list:", error);
    res.status(500).json({ message: "Failed to archive cards in list" });
  }
});

export default router;
