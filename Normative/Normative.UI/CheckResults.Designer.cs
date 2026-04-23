namespace Normative
{
    partial class CheckResults
    {
        /// <summary>
        /// Required designer variable.
        /// </summary>
        private System.ComponentModel.IContainer components = null;

        /// <summary>
        /// Clean up any resources being used.
        /// </summary>
        /// <param name="disposing">true if managed resources should be disposed; otherwise, false.</param>
        protected override void Dispose(bool disposing)
        {
            if (disposing && (components != null))
            {
                components.Dispose();
            }
            base.Dispose(disposing);
        }

        #region Windows Form Designer generated code

        /// <summary>
        /// Required method for Designer support - do not modify
        /// the contents of this method with the code editor.
        /// </summary>
        private void InitializeComponent()
        {
            this.gdv_result = new System.Windows.Forms.DataGridView();
            this.StandardName = new System.Windows.Forms.DataGridViewTextBoxColumn();
            this.StandardNo = new System.Windows.Forms.DataGridViewTextBoxColumn();
            this.errorinfo = new System.Windows.Forms.DataGridViewTextBoxColumn();
            this.CorrectStandardName = new System.Windows.Forms.DataGridViewTextBoxColumn();
            this.CorrectStandardNo = new System.Windows.Forms.DataGridViewTextBoxColumn();
            this.lab_filename = new System.Windows.Forms.Label();
            ((System.ComponentModel.ISupportInitialize)(this.gdv_result)).BeginInit();
            this.SuspendLayout();
            // 
            // gdv_result
            // 
            this.gdv_result.AllowUserToAddRows = false;
            this.gdv_result.Anchor = ((System.Windows.Forms.AnchorStyles)((((System.Windows.Forms.AnchorStyles.Top | System.Windows.Forms.AnchorStyles.Bottom) 
            | System.Windows.Forms.AnchorStyles.Left) 
            | System.Windows.Forms.AnchorStyles.Right)));
            this.gdv_result.BackgroundColor = System.Drawing.SystemColors.ButtonHighlight;
            this.gdv_result.ColumnHeadersHeightSizeMode = System.Windows.Forms.DataGridViewColumnHeadersHeightSizeMode.AutoSize;
            this.gdv_result.Columns.AddRange(new System.Windows.Forms.DataGridViewColumn[] {
            this.StandardName,
            this.StandardNo,
            this.errorinfo,
            this.CorrectStandardName,
            this.CorrectStandardNo});
            this.gdv_result.Location = new System.Drawing.Point(7, 47);
            this.gdv_result.Name = "gdv_result";
            this.gdv_result.RowTemplate.Height = 23;
            this.gdv_result.Size = new System.Drawing.Size(1000, 397);
            this.gdv_result.TabIndex = 23;
            this.gdv_result.RowPostPaint += new System.Windows.Forms.DataGridViewRowPostPaintEventHandler(this.gdv_result_RowPostPaint);
            // 
            // StandardName
            // 
            this.StandardName.DataPropertyName = "StandardName";
            this.StandardName.HeaderText = "标准名称";
            this.StandardName.Name = "StandardName";
            this.StandardName.ReadOnly = true;
            this.StandardName.Width = 220;
            // 
            // StandardNo
            // 
            this.StandardNo.DataPropertyName = "StandardNo";
            this.StandardNo.HeaderText = "标准编号";
            this.StandardNo.Name = "StandardNo";
            this.StandardNo.ReadOnly = true;
            this.StandardNo.Width = 150;
            // 
            // errorinfo
            // 
            this.errorinfo.DataPropertyName = "errorinfo";
            this.errorinfo.HeaderText = "错误类型/内容";
            this.errorinfo.Name = "errorinfo";
            this.errorinfo.ReadOnly = true;
            this.errorinfo.Width = 130;
            // 
            // CorrectStandardName
            // 
            this.CorrectStandardName.DataPropertyName = "CorrectStandardName";
            this.CorrectStandardName.HeaderText = "更正后的标准名称";
            this.CorrectStandardName.Name = "CorrectStandardName";
            this.CorrectStandardName.ReadOnly = true;
            this.CorrectStandardName.Width = 220;
            // 
            // CorrectStandardNo
            // 
            this.CorrectStandardNo.DataPropertyName = "CorrectStandardNo";
            this.CorrectStandardNo.HeaderText = "更正后的标准编号";
            this.CorrectStandardNo.Name = "CorrectStandardNo";
            this.CorrectStandardNo.ReadOnly = true;
            this.CorrectStandardNo.Width = 150;
            // 
            // lab_filename
            // 
            this.lab_filename.AutoSize = true;
            this.lab_filename.Font = new System.Drawing.Font("宋体", 12F);
            this.lab_filename.ForeColor = System.Drawing.Color.Red;
            this.lab_filename.Location = new System.Drawing.Point(22, 16);
            this.lab_filename.Name = "lab_filename";
            this.lab_filename.Size = new System.Drawing.Size(71, 16);
            this.lab_filename.TabIndex = 24;
            this.lab_filename.Text = "文件名称";
            // 
            // CheckResults
            // 
            this.AutoScaleDimensions = new System.Drawing.SizeF(6F, 12F);
            this.AutoScaleMode = System.Windows.Forms.AutoScaleMode.Font;
            this.ClientSize = new System.Drawing.Size(1015, 450);
            this.Controls.Add(this.lab_filename);
            this.Controls.Add(this.gdv_result);
            this.Name = "CheckResults";
            this.ShowIcon = false;
            this.StartPosition = System.Windows.Forms.FormStartPosition.CenterScreen;
            this.Text = "检查结果";
            this.Load += new System.EventHandler(this.CheckResults_Load);
            ((System.ComponentModel.ISupportInitialize)(this.gdv_result)).EndInit();
            this.ResumeLayout(false);
            this.PerformLayout();

        }

        #endregion

        private System.Windows.Forms.DataGridView gdv_result;
        private System.Windows.Forms.Label lab_filename;
        private System.Windows.Forms.DataGridViewTextBoxColumn StandardName;
        private System.Windows.Forms.DataGridViewTextBoxColumn StandardNo;
        private System.Windows.Forms.DataGridViewTextBoxColumn errorinfo;
        private System.Windows.Forms.DataGridViewTextBoxColumn CorrectStandardName;
        private System.Windows.Forms.DataGridViewTextBoxColumn CorrectStandardNo;
    }
}