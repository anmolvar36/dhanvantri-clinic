import * as departmentService from '../services/department.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
export const getDepartments = asyncHandler(async (req, res) => {
    const departments = await departmentService.getDepartments(Number(req.clinicId));
    res.status(200).json({ status: 'success', data: departments });
});
export const createDepartment = asyncHandler(async (req, res) => {
    const department = await departmentService.createDepartment(Number(req.clinicId), req.body);
    res.status(201).json({ status: 'success', data: department });
});
export const deleteDepartment = asyncHandler(async (req, res) => {
    await departmentService.deleteDepartment(Number(req.params.id));
    res.status(200).json({ status: 'success', data: null });
});
export const updateNotificationStatus = asyncHandler(async (req, res) => {
    const notification = await departmentService.updateNotificationStatus(Number(req.params.id), req.body.status);
    res.status(200).json({ status: 'success', data: notification });
});
export const getNotifications = asyncHandler(async (req, res) => {
    if (req.user?.role === 'SUPER_ADMIN') {
        const notifications = await departmentService.getAllSuperAdminNotifications();
        return res.status(200).json({ status: 'success', data: notifications });
    }
    if (!req.clinicId) {
        return res.status(200).json({ status: 'success', data: [] });
    }
    const notifications = await departmentService.getNotifications(Number(req.clinicId));
    res.status(200).json({ status: 'success', data: notifications });
});
export const getUnreadCount = asyncHandler(async (req, res) => {
    if (req.user?.role === 'SUPER_ADMIN') {
        const count = await departmentService.getSuperAdminUnreadCount();
        return res.status(200).json({ status: 'success', data: { count } });
    }
    if (!req.clinicId) {
        return res.status(200).json({ status: 'success', data: { count: 0 } });
    }
    const department = req.query.department ? String(req.query.department) : undefined;
    const count = await departmentService.getUnreadNotificationsCount(Number(req.clinicId), department);
    res.status(200).json({ status: 'success', data: { count } });
});
export const deleteNotification = asyncHandler(async (req, res) => {
    await departmentService.deleteNotification(Number(req.params.id));
    res.status(200).json({ status: 'success', message: 'Notification deleted successfully' });
});
