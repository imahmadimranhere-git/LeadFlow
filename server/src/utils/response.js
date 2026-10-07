// Standard response format used by every API
export const sendSuccess = (res, data = {}, statusCode = 200) =>
  res.status(statusCode).json({ success: true, data });

export const sendPaginated = (res, items, { page, limit, total }) =>
  res.status(200).json({
    success: true,
    data: {
      items,
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    },
  });
