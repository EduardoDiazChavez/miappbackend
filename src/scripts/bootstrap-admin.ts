import { connectToDatabase, disconnectFromDatabase } from "../database.js";
import { User } from "../models/User.js";

const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
const name = process.env.BOOTSTRAP_ADMIN_NAME?.trim();

if (!email || !name) {
  throw new Error(
    "Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_NAME before bootstrapping.",
  );
}

try {
  await connectToDatabase();
  const existingUser = await User.findOne({ email });
  if (existingUser && existingUser.role !== "ADMIN" && existingUser.role !== "SUPER_ADMIN") {
    throw new Error("The requested administrator email already belongs to a non-admin account.");
  }
  if (existingUser) {
    existingUser.name = name;
    existingUser.role = "SUPER_ADMIN";
    existingUser.active = true;
    await existingUser.save();
  } else {
    await User.create({ email, name, role: "SUPER_ADMIN", active: true });
  }
  console.info("Super admin bootstrapped; the first verified Google sign-in links the account.");
} finally {
  await disconnectFromDatabase();
}
