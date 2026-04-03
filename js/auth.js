// ============================================
// AUTH - Login / Signup / Session Management
// ============================================

// Check if user is logged in
async function checkAuth() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    window.location.href = '../index.html';
    return null;
  }
  return session;
}

// Get current user profile
async function getCurrentUser() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;

  const { data: profile } = await sb
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  return { ...user, profile };
}

// Login
async function login(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({
    email,
    password
  });

  if (error) throw error;
  return data;
}

// Signup
async function signup(email, password, name, department) {
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: {
      data: {
        name: name,
        department: department
      }
    }
  });

  if (error) throw error;

  // Create profile
  if (data.user) {
    await sb.from('profiles').upsert({
      id: data.user.id,
      email: email,
      name: name,
      department: department,
      role: 'member',
      created_at: new Date().toISOString()
    });
  }

  return data;
}

// Logout
async function logout() {
  await sb.auth.signOut();
  window.location.href = '../index.html';
}

// Get initials from name
function getInitials(name) {
  if (!name) return '?';
  return name.charAt(0).toUpperCase();
}
