document.getElementById("friendBtn").addEventListener("click", () => {
  document.getElementById("friend-container").style.display = "block";
  document.getElementById("bot-container").style.display = "none";
});

document.getElementById("botBtn").addEventListener("click", () => {
  document.getElementById("bot-container").style.display = "block";
  document.getElementById("friend-container").style.display = "none";
});

document.getElementById("createRoomBtn").addEventListener("click", () => {
  alert("Create Room functionality to be implemented.");
});

document.getElementById("enterRoomBtn").addEventListener("click", () => {
  const roomCode = prompt("Enter Room Code:");
  if (roomCode) {
    alert(`Entered Room Code: ${roomCode}`);
  }
});

document.getElementById("easyModeBtn").addEventListener("click", () => {
  alert("Easy Mode selected.");
});

document.getElementById("hardModeBtn").addEventListener("click", () => {
  alert("Hard Mode selected.");
});
