// js/02-auth-boot.js — Start-up, sign in / sign up / sign out, login screen
/* ---------------------------- boot ---------------------------- */

function boot(){
  initializeTheme();
  if (document.body.dataset.mode === "preview"){
    if (window.__previewBooted) return;
    window.__previewBooted = true;
    currentUser = {displayName:"Preview", email:"preview@local"};
    rooms = (window.SEED_ROOMS || []).map((room, index)=>({
      id: "preview-" + index,
      ...room,
      type: "Room",
      x: 20 + (index % 6) * 150,
      y: 20 + Math.floor(index / 6) * 130,
      beds: room.beds.map(bed=>({...bed, reservedFor:null}))
    }));
    shapes = [];
    prospects = [];
    temporaryClients = [];
    startClock();
    wireStaticUI();
    showApp();
    return;
  }
  wireLoginControls();
  const cfg = window.FIREBASE_CONFIG;
  const notConfigured = !cfg || cfg.apiKey === "YOUR_API_KEY";
  if (notConfigured){
    document.getElementById("configWarning").style.display = "block";
    document.getElementById("signInBtn").disabled = true;
    document.getElementById("signUpBtn").disabled = true;
    document.getElementById("googleSignInBtn").disabled = true;
    document.getElementById("forgotPasswordBtn").disabled = true;
    startClock(); // still show clock even if not configured
    return;
  }
  firebase.initializeApp(cfg);
  auth = firebase.auth();
  db = firebase.firestore();

  document.getElementById("signInBtn").addEventListener("click", signIn);
  document.getElementById("signUpBtn").addEventListener("click", signUp);
  document.getElementById("googleSignInBtn").addEventListener("click", signInWithGoogle);
  document.getElementById("signOutBtn").addEventListener("click", ()=>auth.signOut());
  if (location.protocol !== "file:"){
    auth.getRedirectResult().catch(err=>
      showAuthStatus("Google sign-in failed: " + authErrorMessage(err), true)
    );
  }

  auth.onAuthStateChanged(user=>{
    if (user){
      const allowed = window.ALLOWED_EMAILS || [];
      if (allowed.length && !allowed.includes(user.email)){
        alert("This account (" + user.email + ") is not authorized for this workspace.");
        auth.signOut();
        return;
      }
      if (currentUser && currentUser.uid !== user.uid){
        rooms = [];
        stopViewerAccess();
        tenantHistory = [];
        shapes = [];
        prospects = [];
        temporaryClients = [];
        assistantDataLoaded = {rooms:false,shapes:false,prospects:false,temporaryClients:false};
      }
      currentUser = user;
      showApp();
    } else {
      currentUser = null;
      showLogin();
      if (unsubRooms) unsubRooms();
      if (unsubShapes) unsubShapes();
      if (unsubProspects) unsubProspects();
      if (unsubTemporaryClients) unsubTemporaryClients();
      if (unsubHistory) unsubHistory();
      stopViewerAccess();
      tenantHistory = [];
      rooms = [];
      shapes = [];
      prospects = [];
      temporaryClients = [];
      assistantDataLoaded = {rooms:false,shapes:false,prospects:false,temporaryClients:false};
    }
  });

  startClock();
  wireStaticUI();
}

function signIn(){
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  if (!email || !password){
    showAuthStatus("Enter your email and password.", true);
    return;
  }
  auth.signInWithEmailAndPassword(email, password).catch(err=>
    showAuthStatus("Sign-in failed: " + authErrorMessage(err), true)
  );
}

async function signUp(){
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  const name = document.getElementById("nameInput").value.trim();
  if (!name){
    showAuthStatus("Enter your full name to create an account.", true);
    document.getElementById("nameInput").focus();
    return;
  }
  if (!email || !password){
    showAuthStatus("Enter your email and password.", true);
    return;
  }
  if (password.length < 6){
    showAuthStatus("Password must be at least 6 characters.", true);
    return;
  }
  try{
    const credential = await auth.createUserWithEmailAndPassword(email, password);
    await credential.user.updateProfile({displayName:name});
  }catch(err){
    showAuthStatus("Account creation failed: " + authErrorMessage(err), true);
  }
}

function signInWithGoogle(){
  const provider = new firebase.auth.GoogleAuthProvider();
  auth.signInWithPopup(provider).catch(err=>{
    if (err.code === "auth/popup-blocked" ||
        err.code === "auth/operation-not-supported-in-this-environment"){
      return auth.signInWithRedirect(provider).catch(redirectError=>
        showAuthStatus("Google sign-in failed: " + authErrorMessage(redirectError), true)
      );
    }
    if (err.code === "auth/popup-closed-by-user" ||
        err.code === "auth/cancelled-popup-request") return;
    showAuthStatus("Google sign-in failed: " + authErrorMessage(err), true);
  });
}

function authErrorMessage(error){
  const messages = {
    "auth/email-already-in-use":"An account already exists for this email. Sign in instead.",
    "auth/invalid-email":"Enter a valid email address.",
    "auth/weak-password":"Choose a stronger password (at least 6 characters).",
    "auth/user-not-found":"No account was found for this email.",
    "auth/wrong-password":"The password is incorrect.",
    "auth/invalid-credential":"The email or password is incorrect.",
    "auth/operation-not-allowed":"This sign-in method is disabled. Enable it in Firebase Authentication settings.",
    "auth/unauthorized-domain":"This site domain is not authorized in Firebase Authentication settings.",
    "auth/operation-not-supported-in-this-environment":"Open the app through HTTPS or localhost to use Google sign-in.",
    "auth/too-many-requests":"Too many attempts. Wait a little while, then try again.",
    "auth/network-request-failed":"Network error. Check your connection and try again."
  };
  return messages[error.code] || error.message || "Please try again.";
}

function wireLoginControls(){
  document.getElementById("loginTabBtn").addEventListener("click", ()=>setAuthMode("login"));
  document.getElementById("signupTabBtn").addEventListener("click", ()=>setAuthMode("signup"));
  document.getElementById("footerActionBtn").addEventListener("click", ()=>{
    setAuthMode(document.getElementById("signUpBtn").hidden ? "signup" : "login");
  });
  document.getElementById("passwordToggle").addEventListener("click", togglePasswordVisibility);
  document.getElementById("forgotPasswordBtn").addEventListener("click", sendPasswordReset);
  document.getElementById("password").addEventListener("keydown", event=>{
    if (event.key === "Enter") (document.getElementById("signUpBtn").hidden ? signIn : signUp)();
  });
  document.getElementById("email").addEventListener("keydown", event=>{
    if (event.key === "Enter") (document.getElementById("signUpBtn").hidden ? signIn : signUp)();
  });
  document.getElementById("email").addEventListener("input", ()=>showAuthStatus(""));

  ["heroThemeToggle", "mobileThemeToggle"].forEach(id=>{
    document.getElementById(id).addEventListener("click", toggleLoginTheme);
  });
}

function initializeTheme(){
  const darkTheme = localStorage.getItem("loginTheme") === "dark";
  document.body.classList.toggle("auth-dark", darkTheme);
  updateThemeControls(darkTheme);
  const appToggle = document.getElementById("appThemeToggle");
  if (appToggle) appToggle.addEventListener("click", toggleLoginTheme);
}

function updateThemeControls(isDark){
  document.querySelectorAll("#heroThemeToggle i, #mobileThemeToggle i, #appThemeIcon").forEach(icon=>{
    icon.className = isDark ? "fa-solid fa-sun" : "fa-solid fa-moon";
  });
  document.querySelectorAll("#heroThemeToggle, #mobileThemeToggle, #appThemeToggle").forEach(button=>{
    const label = isDark ? "Switch to light mode" : "Switch to dark mode";
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
  });
}

function setAuthMode(mode){
  const isSignup = mode === "signup";
  document.querySelector(".auth-tabs").classList.toggle("signup-mode", isSignup);
  document.getElementById("loginTabBtn").classList.toggle("active", !isSignup);
  document.getElementById("signupTabBtn").classList.toggle("active", isSignup);
  document.getElementById("loginTabBtn").setAttribute("aria-selected", String(!isSignup));
  document.getElementById("signupTabBtn").setAttribute("aria-selected", String(isSignup));
  document.getElementById("formTitle").textContent = isSignup ? "Create your account" : "Welcome back";
  document.getElementById("formSubtitle").textContent = isSignup ? "Set up your dorm vacancy workspace." : "Sign in to manage dormitory vacancies.";
  document.getElementById("nameFieldContainer").hidden = !isSignup;
  document.getElementById("forgotPasswordBtn").hidden = isSignup;
  document.getElementById("signInBtn").hidden = isSignup;
  document.getElementById("signUpBtn").hidden = !isSignup;
  document.getElementById("footerPrompt").textContent = isSignup ? "Already have an account?" : "New to the tracker?";
  document.getElementById("footerActionBtn").textContent = isSignup ? "Sign in" : "Create an account";
  document.getElementById("password").autocomplete = isSignup ? "new-password" : "current-password";
  showAuthStatus("");
}

function toggleLoginTheme(){
  const isDark = !document.body.classList.contains("auth-dark");
  document.body.classList.toggle("auth-dark", isDark);
  localStorage.setItem("loginTheme", isDark ? "dark" : "light");
  updateThemeControls(isDark);
}

function togglePasswordVisibility(){
  const password = document.getElementById("password");
  const button = document.getElementById("passwordToggle");
  const visible = password.type === "password";
  password.type = visible ? "text" : "password";
  button.setAttribute("aria-label", visible ? "Hide password" : "Show password");
  button.innerHTML = `<i class="fa-solid ${visible ? "fa-eye-slash" : "fa-eye"}"></i>`;
}

async function sendPasswordReset(){
  const email = document.getElementById("email").value.trim();
  if (!email){
    showAuthStatus("Enter your email address first.", true);
    document.getElementById("email").focus();
    return;
  }
  try{
    await auth.sendPasswordResetEmail(email);
    showAuthStatus("Password reset email sent.");
  }catch(err){
    showAuthStatus("Could not send reset email: " + authErrorMessage(err), true);
  }
}

function showAuthStatus(message, isError=false){
  const status = document.getElementById("authStatus");
  status.textContent = message;
  status.classList.toggle("is-error", isError);
}

function showLogin(){
  document.getElementById("loginScreen").style.display = "flex";
  document.getElementById("app").classList.remove("visible");
}

function showApp(){
  const loginScreen = document.getElementById("loginScreen");
  if (loginScreen) loginScreen.style.display = "none";
  document.getElementById("app").classList.add("visible");
  document.getElementById("userName").textContent = currentUser.displayName || currentUser.email;
  document.getElementById("userPhoto").src = currentUser.photoURL || "";
  if (db) subscribeData();
  renderActive();
}
