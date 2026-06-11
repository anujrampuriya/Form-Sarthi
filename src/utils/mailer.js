const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.SMTP_EMAIL,
    pass: process.env.SMTP_PASSWORD
  }
});

/**
 * Sends a verification email after a Google login.
 * @param {string} toEmail 
 * @param {string} userName 
 * @param {string} allowToken 
 * @param {string} denyToken 
 */
async function sendVerificationEmail(toEmail, userName, allowToken, denyToken) {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  const allowUrl = `${baseUrl}/api/auth/verify/${allowToken}`;
  const denyUrl = `${baseUrl}/api/auth/deny/${denyToken}`;

  const mailOptions = {
    from: `"FormSarthi Security" <${process.env.SMTP_EMAIL}>`,
    to: toEmail,
    subject: 'Security Alert: New Google Login',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
        <h2 style="color: #333; text-align: center;">Verify Your Login</h2>
        <p>Hi ${userName},</p>
        <p>We detected a new login to your FormSarthi account using Google Auth.</p>
        <p>If this was you, you can continue to your vault. If you did not initiate this login, please block access immediately.</p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${allowUrl}" style="background-color: #8b5cf6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; margin-right: 15px; font-weight: bold;">Yes, this was me</a>
          <a href="${denyUrl}" style="background-color: #ef4444; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold;">No, block access</a>
        </div>
        
        <p style="color: #666; font-size: 12px;">If you do not respond, the login will be allowed by default after the timeout.</p>
      </div>
    `
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Verification email sent: %s', info.messageId);
    return true;
  } catch (error) {
    console.error('Error sending verification email:', error);
    return false;
  }
}

module.exports = { sendVerificationEmail };
