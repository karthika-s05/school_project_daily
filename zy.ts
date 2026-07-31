// import { Request, Response } from 'express';

// const getHomeWork = async (req: Request, res: Response) => {
//   const { administrationId, role } = req.user as { administrationId: string, role: string, classId?: string, sectionId?: string };
//   const classId = role === "Student" ? (req.user as { classId: string }).classId : req.body.classId as string;
//   const sectionId = role === "Student" ? (req.user as { sectionId: string }).sectionId : req.body.sectionId as string;

//   try {
//     if (!administrationId || !classId || !sectionId) {
//       throw new Error("Missing Credential");
//     } else {
//       await homeWorkModel.getHomeWork(
//         classId,
//         sectionId,
//         administrationId,
//         (err: Error | null, homeWork: any) => {
//           if (err) {
//             res.send({
//               status: "Error",
//               message: "HomeWork list not retrieved",
//               data: err.message,
//             });
//           } else {
//             const data = {
//               status: "success",
//               message: "HomeWork list retrieved successfully",
//               data: homeWork[0],
//             };
//             logger.info(`${req.path} -- ${req.method} -- Success`);
//             res.send(data);
//           }
//         }
//       );
//     }
//   } catch (error) {
//     logger.error(`${req.path} -- ${req.method} -- Error: ${error.message}`);
//     res.status(500).send({
//       status: "Error",
//       message: error.message,
//     });
//   }
// };

// export { getHomeWork };
